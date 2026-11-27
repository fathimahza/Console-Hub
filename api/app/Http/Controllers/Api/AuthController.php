<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequestOtpRequest;
use App\Http\Requests\RegisterVerifyRequest;
use App\Http\Requests\RequestOtpRequest;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Requests\VerifyOtpRequest;
use App\Http\Resources\AuthUserResource;
use App\Mail\OtpCodeMail;
use App\Models\OtpCode;
use App\Models\Role;
use App\Models\User;
use App\Services\Audit;
use App\Services\AuthTokenService;
use App\Services\RecaptchaService;
use App\Support\ApiException;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

class AuthController extends Controller
{
    private const OTP_TTL_SECONDS = 300;

    private const OTP_RATE_LIMIT_SECONDS = 60;

    private const OTP_MAX_ATTEMPTS = 5;

    private const RESEND_TOKEN_PREFIX = 'otp_resend:';

    private const RESEND_TOKEN_TTL_SECONDS = 900;

    public function login(LoginRequest $request, AuthTokenService $authTokens): JsonResponse
    {
        $email = strtolower(trim($request->string('email')->toString()));
        $user = User::query()->with('role')->whereRaw('LOWER(email) = ?', [$email])->first();

        // Same answer for an unknown email and a wrong password.
        if (! $user || $user->password === null || ! Hash::check($request->string('password')->toString(), $user->password)) {
            throw new ApiException(401, 'UNAUTHENTICATED', 'Email atau sandi salah.');
        }

        if (! $user->is_active) {
            throw new ApiException(403, 'FORBIDDEN', 'Akun Anda dinonaktifkan. Hubungi Admin IT untuk mengaktifkannya.');
        }

        return response()->json($authTokens->issue($user, 'password'));
    }

    public function requestOtp(RequestOtpRequest $request, RecaptchaService $recaptcha): JsonResponse
    {
        $email = strtolower(trim($request->string('email')->toString()));

        $this->assertRecaptchaOrResend(
            'login',
            $email,
            $request->string('recaptcha_token')->toString(),
            $request->string('resend_token')->toString(),
            $request->ip(),
            $recaptcha,
        );

        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        if (! $user) {
            throw new ApiException(404, 'NOT_FOUND', 'Email belum terdaftar di sistem. Silakan daftar terlebih dahulu.');
        }

        if (! $user->is_active) {
            throw new ApiException(403, 'FORBIDDEN', 'Akun Anda dinonaktifkan. Hubungi Admin IT untuk mengaktifkannya.');
        }

        return $this->issueAndSendOtpResponse($email, $user->name, 'login');
    }

    public function verifyOtp(VerifyOtpRequest $request, AuthTokenService $authTokens): JsonResponse
    {
        $email = strtolower(trim($request->string('email')->toString()));
        $otp = $request->string('otp')->toString();

        $this->consumeOtpOrFail($email, $otp);

        $user = User::query()->with('role')->whereRaw('LOWER(email) = ?', [$email])->first();

        if (! $user) {
            throw new ApiException(404, 'NOT_FOUND', 'Email belum terdaftar di sistem. Silakan daftar terlebih dahulu.');
        }

        if (! $user->is_active) {
            throw new ApiException(403, 'FORBIDDEN', 'Akun Anda dinonaktifkan. Hubungi Admin IT untuk mengaktifkannya.');
        }

        Cache::forget(self::RESEND_TOKEN_PREFIX."login:{$email}");

        return response()->json($authTokens->issue($user, 'otp'));
    }

    public function registerRequestOtp(RegisterRequestOtpRequest $request, RecaptchaService $recaptcha): JsonResponse
    {
        $email = strtolower(trim($request->string('email')->toString()));
        $name = trim($request->string('name')->toString());

        $this->assertRecaptchaOrResend(
            'register',
            $email,
            $request->string('recaptcha_token')->toString(),
            $request->string('resend_token')->toString(),
            $request->ip(),
            $recaptcha,
        );

        if (User::query()->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            throw ApiException::validation(
                ['email' => ['Email ini sudah terdaftar. Silakan masuk melalui halaman login.']],
                'Email ini sudah terdaftar. Silakan masuk melalui halaman login.',
            );
        }

        return $this->issueAndSendOtpResponse($email, $name, 'register');
    }

    public function registerVerify(RegisterVerifyRequest $request, AuthTokenService $authTokens, Audit $audit): JsonResponse
    {
        $name = trim($request->string('name')->toString());
        $email = strtolower(trim($request->string('email')->toString()));
        $otp = $request->string('otp')->toString();
        $signupToken = trim($request->string('signup_token')->toString());

        if (User::query()->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            throw ApiException::validation(
                ['email' => ['Email ini sudah terdaftar. Silakan masuk melalui halaman login.']],
                'Email ini sudah terdaftar. Silakan masuk melalui halaman login.',
            );
        }

        $role = Role::query()->where('code', Role::USER)->firstOrFail();

        $this->consumeOtpOrFail($email, $otp);

        $googleId = $signupToken !== '' ? $this->resolveGoogleSignupId($signupToken, $email) : null;

        $user = DB::transaction(function () use ($name, $email, $googleId, $role): User {
            if (User::query()->whereRaw('LOWER(email) = ?', [$email])->lockForUpdate()->exists()) {
                throw ApiException::validation(
                    ['email' => ['Email ini sudah terdaftar. Silakan masuk melalui halaman login.']],
                    'Email ini sudah terdaftar. Silakan masuk melalui halaman login.',
                );
            }

            return User::query()->create([
                'name' => $name,
                'email' => $email,
                'password' => null,
                'google_id' => $googleId,
                'role_id' => $role->id,
                'is_active' => true,
            ]);
        });

        Cache::forget(self::RESEND_TOKEN_PREFIX."register:{$email}");

        $method = $googleId !== null ? 'register_google' : 'register_otp';

        $audit->record(
            'auth.register',
            'user',
            (string) $user->id,
            new: [
                'email' => $user->email,
                'name' => $user->name,
                'role' => $role->code,
                'method' => $method,
            ],
            userId: $user->id,
        );

        return response()->json($authTokens->issue($user, $method), 201);
    }

    public function logout(Request $request): Response
    {
        $token = $request->user()?->currentAccessToken();

        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        }

        return response()->noContent();
    }

    public function me(Request $request): AuthUserResource
    {
        /** @var User $user */
        $user = $request->user();

        return new AuthUserResource($user->load('role'));
    }

    public function updateProfile(UpdateProfileRequest $request, Audit $audit): AuthUserResource
    {
        /** @var User $user */
        $user = $request->user();
        $newName = (string) $request->validated('name');
        $oldName = $user->name;

        if ($newName !== $oldName) {
            $user->forceFill(['name' => $newName])->save();

            $audit->record(
                'auth.profile_updated',
                'user',
                (string) $user->id,
                old: ['name' => $oldName],
                new: ['name' => $newName],
                userId: $user->id,
            );
        }

        return new AuthUserResource($user->load('role'));
    }

    private function assertRecaptchaOrResend(
        string $purpose,
        string $email,
        string $recaptchaToken,
        string $resendToken,
        ?string $ip,
        RecaptchaService $recaptcha,
    ): void {
        if ($resendToken !== '') {
            $cachedToken = Cache::get(self::RESEND_TOKEN_PREFIX."{$purpose}:{$email}");
            if (is_string($cachedToken) && $cachedToken !== '' && hash_equals($cachedToken, $resendToken)) {
                return;
            }
        }

        if (! $recaptcha->verify($recaptchaToken !== '' ? $recaptchaToken : null, $ip)) {
            throw ApiException::validation(
                ['recaptcha_token' => ['Verifikasi reCAPTCHA gagal. Silakan coba lagi.']],
                'Verifikasi reCAPTCHA gagal. Silakan coba lagi.',
            );
        }
    }

    private function issueAndSendOtpResponse(string $email, string $recipientName, string $purpose): JsonResponse
    {
        $rateLimitKey = 'otp-request:'.$email;

        if (RateLimiter::tooManyAttempts($rateLimitKey, 1)) {
            $retryAfter = max(1, RateLimiter::availableIn($rateLimitKey));

            return ApiResponse::error(
                429,
                'RATE_LIMITED',
                "Terlalu banyak permintaan kode OTP. Coba lagi dalam {$retryAfter} detik.",
                ['retry_after' => $retryAfter],
            )->header('Retry-After', (string) $retryAfter);
        }

        $otp = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $now = now();

        DB::transaction(function () use ($email, $otp, $now): void {
            OtpCode::query()
                ->where('email', $email)
                ->whereNull('used_at')
                ->update(['used_at' => $now]);

            OtpCode::query()->create([
                'email' => $email,
                'code_hash' => Hash::make($otp),
                'attempts' => 0,
                'expires_at' => $now->copy()->addSeconds(self::OTP_TTL_SECONDS),
            ]);
        });

        Mail::to($email)->send(new OtpCodeMail(
            $otp,
            $recipientName,
            (int) (self::OTP_TTL_SECONDS / 60),
            $purpose,
        ));

        RateLimiter::hit($rateLimitKey, self::OTP_RATE_LIMIT_SECONDS);

        $resendToken = Str::random(48);
        Cache::put(
            self::RESEND_TOKEN_PREFIX."{$purpose}:{$email}",
            $resendToken,
            now()->addSeconds(self::RESEND_TOKEN_TTL_SECONDS),
        );

        $message = $purpose === 'register'
            ? 'Kode verifikasi pendaftaran telah dikirim ke email Anda.'
            : 'Kode OTP telah dikirim ke email Anda.';

        return response()->json([
            'data' => [
                'message' => $message,
                'expires_in' => self::OTP_TTL_SECONDS,
                'resend_token' => $resendToken,
            ],
            'message' => $message,
            'expires_in' => self::OTP_TTL_SECONDS,
        ]);
    }

    private function consumeOtpOrFail(string $email, string $otp): void
    {
        $status = DB::transaction(function () use ($email, $otp): string {
            $otpRecord = OtpCode::query()
                ->where('email', $email)
                ->whereNull('used_at')
                ->where('expires_at', '>', now())
                ->latest('id')
                ->lockForUpdate()
                ->first();

            if (! $otpRecord) {
                return 'expired';
            }

            if ($otpRecord->attempts >= self::OTP_MAX_ATTEMPTS) {
                $otpRecord->used_at = now();
                $otpRecord->save();

                return 'too_many_attempts';
            }

            if (! Hash::check($otp, $otpRecord->code_hash)) {
                $otpRecord->attempts++;

                if ($otpRecord->attempts >= self::OTP_MAX_ATTEMPTS) {
                    $otpRecord->used_at = now();
                    $otpRecord->save();

                    return 'too_many_attempts';
                }

                $otpRecord->save();

                return 'invalid';
            }

            $otpRecord->used_at = now();
            $otpRecord->save();

            return 'verified';
        });

        if ($status === 'expired') {
            throw ApiException::validation(
                ['otp' => ['Kode OTP tidak valid atau sudah kedaluwarsa.']],
                'Kode OTP tidak valid atau sudah kedaluwarsa.',
            );
        }

        if ($status === 'too_many_attempts') {
            throw new ApiException(429, 'RATE_LIMITED', 'Terlalu banyak percobaan salah. Silakan minta kode OTP baru.');
        }

        if ($status === 'invalid') {
            throw ApiException::validation(
                ['otp' => ['Kode OTP tidak valid.']],
                'Kode OTP tidak valid.',
            );
        }
    }

    private function resolveGoogleSignupId(string $signupToken, string $email): ?string
    {
        $cached = Cache::pull(GoogleAuthController::OAUTH_SIGNUP_CACHE_PREFIX.$signupToken);

        if (! is_array($cached)) {
            return null;
        }

        $cachedEmail = isset($cached['email']) && is_string($cached['email']) ? strtolower(trim($cached['email'])) : '';
        $googleId = isset($cached['google_id']) && is_string($cached['google_id']) ? trim($cached['google_id']) : '';

        if ($cachedEmail !== $email || $googleId === '') {
            return null;
        }

        if (User::query()->where('google_id', $googleId)->exists()) {
            return null;
        }

        return $googleId;
    }
}
