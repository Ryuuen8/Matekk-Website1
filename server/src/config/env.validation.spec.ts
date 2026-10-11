import { describe, expect, it } from 'vitest';
import { envValidationSchema } from './env.validation.js';

const requiredSupabaseConfig = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('environment validation', () => {
    it('provides a development JWT secret and empty CORS allowlist by default', () => {
        const { error, value } = envValidationSchema.validate(requiredSupabaseConfig);

        expect(error).toBeUndefined();
        expect(value.JWT_SECRET).toBe('development-jwt-secret-change-me');
        expect(value.CORS_ORIGINS).toBe('');
    });

    it('requires a frontend origin allowlist for production', () => {
        const { error } = envValidationSchema.validate({
            ...requiredSupabaseConfig,
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(32),
        });

        expect(error?.details[0]?.path).toEqual(['CORS_ORIGINS']);
    });

    it('accepts a configured production frontend origin allowlist', () => {
        const origins = 'https://academy.example.com,https://www.example.com';
        const { error, value } = envValidationSchema.validate({
            ...requiredSupabaseConfig,
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(32),
            CORS_ORIGINS: origins,
        });

        expect(error).toBeUndefined();
        expect(value.CORS_ORIGINS).toBe(origins);
    });

    it('rejects production CORS values that are not HTTPS origins', () => {
        const { error } = envValidationSchema.validate({
            ...requiredSupabaseConfig,
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(32),
            CORS_ORIGINS: 'https://academy.example.com/account',
        });

        expect(error?.details[0]?.path).toEqual(['CORS_ORIGINS']);
    });

    it('still requires an explicit JWT secret in production', () => {
        const { error } = envValidationSchema.validate({
            ...requiredSupabaseConfig,
            NODE_ENV: 'production',
            CORS_ORIGINS: 'https://academy.example.com',
        });

        expect(error?.details[0]?.path).toEqual(['JWT_SECRET']);
    });
});
