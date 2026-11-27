<?php

use App\Models\AuditEvent;
use App\Models\Permission;
use App\Models\User;

it('logs in and returns a token with the AuthUser shape', function () {
    $user = User::factory()->create(['password' => 'rahasia-123']);

    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'rahasia-123'])
        ->assertOk()
        ->assertJsonStructure(['data' => ['token', 'user' => ['id', 'name', 'email', 'role' => ['code', 'name'], 'permissions']]])
        ->assertJsonPath('data.user.id', $user->id)
        ->assertJsonPath('data.user.role.code', 'user')
        ->assertJsonPath('data.user.permissions', collect(Permission::USER_DEFAULTS)->sort()->values()->all())
        ->assertJsonMissingPath('data.user.password');

    expect(AuditEvent::query()->where('action', 'auth.login')->where('user_id', $user->id)->exists())->toBeTrue();
});

it('gives the token the configured lifetime', function () {
    config(['sanctum.expiration' => 480]);
    $user = User::factory()->create(['password' => 'rahasia-123']);

    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'rahasia-123'])->assertOk();

    expect($user->tokens()->first()->expires_at->diffInMinutes(now(), true))->toBeGreaterThan(479)->toBeLessThan(481);
});

it('answers the same for a wrong password and an unknown email', function () {
    $user = User::factory()->create(['password' => 'rahasia-123']);

    $wrong = $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'salah']);
    $unknown = $this->postJson('/api/v1/auth/login', ['email' => 'tidak-ada@example.com', 'password' => 'salah']);

    assertApiError($wrong, 401, 'UNAUTHENTICATED');
    assertApiError($unknown, 401, 'UNAUTHENTICATED');
    expect($wrong->json('error.message'))->toBe($unknown->json('error.message'))->toBe('Email atau sandi salah.');
});

it('refuses an inactive account at login', function () {
    $user = User::factory()->inactive()->create(['password' => 'rahasia-123']);

    assertApiError($this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'rahasia-123']), 403, 'FORBIDDEN');
    expect($user->tokens()->count())->toBe(0);
});

it('rejects a malformed login body with 422 and field errors', function () {
    $response = $this->postJson('/api/v1/auth/login', ['email' => 'bukan-email']);

    assertApiError($response, 422, 'VALIDATION_ERROR');
    $response->assertJsonStructure(['error' => ['details' => ['fields' => ['email', 'password']]]]);
});

it('returns the current user with role and permissions from me', function () {
    $admin = User::factory()->admin()->create();

    $this->withToken($admin->createToken('t')->plainTextToken)->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonPath('data.id', $admin->id)
        ->assertJsonPath('data.role', ['code' => 'admin_it', 'name' => 'Admin IT'])
        ->assertJsonCount(count(Permission::ALL), 'data.permissions');
});

it('rejects an expired token with 401', function () {
    $user = User::factory()->create();
    $token = $user->createToken('t', ['*'], now()->subMinute())->plainTextToken;

    assertApiError($this->withToken($token)->getJson('/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
});

it('cuts off a deactivated user on the next request', function () {
    $user = User::factory()->create();
    $token = $user->createToken('t')->plainTextToken;
    $user->update(['is_active' => false]);

    assertApiError($this->withToken($token)->getJson('/api/v1/auth/me'), 401, 'UNAUTHENTICATED');
    expect($user->tokens()->count())->toBe(0);
});

it('revokes only the current token on logout', function () {
    $user = User::factory()->create();
    $token = $user->createToken('t')->plainTextToken;
    $user->createToken('other');

    $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();

    expect($user->tokens()->count())->toBe(1);
});

it('rate limits login to 5 attempts per minute per email and ip', function () {
    foreach (range(1, 5) as $_) {
        $this->postJson('/api/v1/auth/login', ['email' => 'x@example.com', 'password' => 'salah'])->assertStatus(401);
    }

    assertApiError($this->postJson('/api/v1/auth/login', ['email' => 'x@example.com', 'password' => 'salah']), 429, 'RATE_LIMITED');
});

it('echoes or creates an X-Request-Id on every response', function () {
    $this->postJson('/api/v1/auth/login', [], ['X-Request-Id' => 'req-12345678'])->assertHeader('X-Request-Id', 'req-12345678');
    expect($this->getJson('/api/v1/auth/me')->headers->get('X-Request-Id'))->toMatch('/^[0-9a-f-]{36}$/');
});

it('allows an authenticated active user to update their username via profile endpoint and records audit', function () {
    $user = User::factory()->create(['name' => 'budi_lama']);
    $token = $user->createToken('t')->plainTextToken;

    $response = $this->withToken($token)->patchJson('/api/v1/auth/profile', [
        'name' => 'nabilkencana20',
        'email' => 'hacker@example.com',
        'is_active' => false,
    ]);

    $response->assertOk()
        ->assertJsonPath('data.id', $user->id)
        ->assertJsonPath('data.name', 'nabilkencana20')
        ->assertJsonPath('data.email', $user->email)
        ->assertJsonPath('data.role.code', 'user');

    $user->refresh();
    expect($user->name)->toBe('nabilkencana20')
        ->and($user->email)->not->toBe('hacker@example.com')
        ->and($user->is_active)->toBeTrue();

    $audit = AuditEvent::query()->where('action', 'auth.profile_updated')->where('user_id', $user->id)->sole();
    expect($audit->old_value)->toBe(['name' => 'budi_lama'])
        ->and($audit->new_value)->toBe(['name' => 'nabilkencana20']);
});

it('does not record redundant audit when submitted username is unchanged', function () {
    $user = User::factory()->create(['name' => 'sama_saja']);
    $token = $user->createToken('t')->plainTextToken;

    $this->withToken($token)->patchJson('/api/v1/auth/profile', ['name' => 'sama_saja'])
        ->assertOk()
        ->assertJsonPath('data.name', 'sama_saja');

    expect(AuditEvent::query()->where('action', 'auth.profile_updated')->count())->toBe(0);
});

it('validates username rules (no uppercase, no spaces, length) and refuses unauthenticated users on profile update', function () {
    assertApiError($this->patchJson('/api/v1/auth/profile', ['name' => 'baru20']), 401, 'UNAUTHENTICATED');

    $user = User::factory()->create(['name' => 'budi_awal']);
    $token = $user->createToken('t')->plainTextToken;

    $short = $this->withToken($token)->patchJson('/api/v1/auth/profile', ['name' => 'ab']);
    assertApiError($short, 422, 'VALIDATION_ERROR');
    $short->assertJsonStructure(['error' => ['details' => ['fields' => ['name']]]]);

    $blank = $this->withToken($token)->patchJson('/api/v1/auth/profile', ['name' => '   ']);
    assertApiError($blank, 422, 'VALIDATION_ERROR');

    $withSpace = $this->withToken($token)->patchJson('/api/v1/auth/profile', ['name' => 'nabil kencana']);
    assertApiError($withSpace, 422, 'VALIDATION_ERROR');
    expect($withSpace->json('error.details.fields.name.0'))->toContain('spasi');

    $leadingSpace = $this->withToken($token)->patchJson('/api/v1/auth/profile', ['name' => ' nabilkencana20 ']);
    assertApiError($leadingSpace, 422, 'VALIDATION_ERROR');

    $withCaps = $this->withToken($token)->patchJson('/api/v1/auth/profile', ['name' => 'Nabil']);
    assertApiError($withCaps, 422, 'VALIDATION_ERROR');
    expect($withCaps->json('error.details.fields.name.0'))->toContain('huruf kapital');
});

it('refuses a deactivated user on profile update', function () {
    $user = User::factory()->create(['name' => 'budi_awal']);
    $token = $user->createToken('t')->plainTextToken;
    $user->update(['is_active' => false]);

    assertApiError($this->withToken($token)->patchJson('/api/v1/auth/profile', ['name' => 'valid_baru']), 401, 'UNAUTHENTICATED');
});
