import { describe, expect, it } from 'vitest';
import { envValidationSchema } from './env.validation.js';

const requiredSupabaseConfig = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('environment validation', () => {
    it('uses Google test CAPTCHA credentials outside production', () => {
        const { error, value } = envValidationSchema.validate(requiredSupabaseConfig);

        expect(error).toBeUndefined();
        expect(value.RECAPTCHA_SECRET_KEY).toBe('6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuZZevZx9c5');
    });

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

    it('allows production to start without CAPTCHA credentials but keeps form submissions disabled', () => {
        const { error, value } = envValidationSchema.validate({
            ...requiredSupabaseConfig,
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(32),
            CORS_ORIGINS: 'https://academy.example.com',
        });

        expect(error).toBeUndefined();
        expect(value.RECAPTCHA_SECRET_KEY).toBeUndefined();
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

    it('accepts an optional four-to-six digit offline module PIN', () => {
        const { error, value } = envValidationSchema.validate({
          SUPABASE_URL: 'https://project.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
          OFFLINE_MODULE_PIN: '246810',
        });

        expect(error).toBeUndefined();
        expect(value.OFFLINE_MODULE_PIN).toBe('246810');
    });

    it('rejects an invalid configured offline module PIN', () => {
        const { error } = envValidationSchema.validate({
          SUPABASE_URL: 'https://project.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
          OFFLINE_MODULE_PIN: 'pin123',
        });

        expect(error?.details[0]?.path).toEqual(['OFFLINE_MODULE_PIN']);
    });
});
