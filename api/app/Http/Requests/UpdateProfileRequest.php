<?php

namespace App\Http\Requests;

use Closure;
use Illuminate\Foundation\Http\FormRequest;

class UpdateProfileRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'name' => [
                'required',
                'string',
                'min:3',
                'max:100',
                function (string $attribute, mixed $value, Closure $fail): void {
                    if (! is_string($value)) {
                        return;
                    }

                    if (preg_match('/\s/u', $value) === 1) {
                        $fail('Username tidak boleh mengandung spasi.');
                    }

                    if ($value !== mb_strtolower($value, 'UTF-8') || preg_match('/\p{Lu}/u', $value) === 1) {
                        $fail('Username tidak boleh mengandung huruf kapital (Caps Lock).');
                    }
                },
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.required' => 'Username wajib diisi.',
            'name.string' => 'Username harus berupa teks.',
            'name.min' => 'Username minimal 3 karakter.',
            'name.max' => 'Username maksimal 100 karakter.',
        ];
    }
}
