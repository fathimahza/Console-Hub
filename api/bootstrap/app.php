<?php

use App\Connectors\Exceptions\ConsoleException;
use App\Http\Middleware\EnsureActiveUser;
use App\Http\Middleware\RequestId;
use App\Http\Middleware\RequirePermission;
use App\Support\ApiException;
use App\Support\ApiResponse;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend(RequestId::class);
        TrimStrings::skipWhen(fn (Request $request): bool => $request->is('api/v1/auth/profile'));
        $middleware->alias(['perm' => RequirePermission::class, 'active' => EnsureActiveUser::class]);
        // Check the permission before route model binding, so a missing record never leaks past a 403.
        $middleware->prependToPriorityList(SubstituteBindings::class, RequirePermission::class);
        $middleware->prependToPriorityList(RequirePermission::class, EnsureActiveUser::class);
        $middleware->throttleApi('api');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontReport([ApiException::class, ConsoleException::class]);

        $exceptions->render(function (Throwable $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return match (true) {
                $e instanceof ApiException => ApiResponse::error($e->status, $e->errorCode, $e->getMessage(), $e->details),
                // Source names and URLs only for Admin IT; User gets an everyday sentence.
                $e instanceof ConsoleException => $request->user()?->hasPermission('admin.consoles.view')
                    ? ApiResponse::error($e->httpStatus(), $e->errorCode, $e->getMessage(), ['source' => $e->console, ...$e->details])
                    : ApiResponse::error($e->httpStatus(), $e->errorCode, $e->userMessage()),
                $e instanceof ValidationException => ApiResponse::error(422, 'VALIDATION_ERROR', 'Input tidak valid.', ['fields' => $e->errors()]),
                $e instanceof AuthenticationException => ApiResponse::error(401, 'UNAUTHENTICATED', 'Sesi tidak valid. Silakan masuk lagi.'),
                $e instanceof ModelNotFoundException, $e instanceof NotFoundHttpException => ApiResponse::error(404, 'NOT_FOUND', 'Data tidak ditemukan.'),
                $e instanceof ThrottleRequestsException => ApiResponse::error(429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar lagi.'),
                $e instanceof HttpExceptionInterface && $e->getStatusCode() === 403 => ApiResponse::error(403, 'FORBIDDEN', 'Akses ditolak.'),
                $e instanceof HttpExceptionInterface && $e->getStatusCode() === 409 => ApiResponse::error(409, 'CONFLICT', $e->getMessage() ?: 'Konflik.'),
                $e instanceof HttpExceptionInterface && $e->getStatusCode() === 405 => ApiResponse::error(404, 'NOT_FOUND', 'Endpoint tidak ditemukan.'),
                default => ApiResponse::error(500, 'SERVER_ERROR', 'Terjadi kesalahan pada server.'),
            };
        });
    })->create();
