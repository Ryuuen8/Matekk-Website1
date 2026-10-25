// src/config/env.validation.ts
import Joi from 'joi';

const developmentJwtSecret = 'development-jwt-secret-change-me';
const recaptchaTestSecretKey = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuZZevZx9c5';

export const envValidationSchema = Joi.object({
    NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
    JWT_SECRET: Joi.string().min(32).when('NODE_ENV', {
        is: Joi.string().valid('development', 'test'),
        then: Joi.string().min(32).default(developmentJwtSecret),
        otherwise: Joi.string().min(32).required(),
    }),
    JWT_EXPIRES_IN: Joi.string().default('24h'),
    RECAPTCHA_SECRET_KEY: Joi.string().min(1).when('NODE_ENV', {
        is: 'production',
        then: Joi.string().min(1).optional(),
        otherwise: Joi.string().min(1).default(recaptchaTestSecretKey),
    }),
    OFFLINE_MODULE_PIN: Joi.string().pattern(/^\d{4,6}$/).allow('').optional(),
    CORS_ORIGINS: Joi.string().when('NODE_ENV', {
        is: 'production',
        then: Joi.string().trim().min(1).required().custom((value, helpers) => {
            const origins = value.split(',').map((origin: string) => origin.trim());
            const hasInvalidOrigin = origins.some((origin: string) => {
                try {
                    const parsedOrigin = new URL(origin);
                    return parsedOrigin.protocol !== 'https:' ||
                        parsedOrigin.origin !== origin ||
                        parsedOrigin.username !== '' ||
                        parsedOrigin.password !== '';
                } catch {
                    return true;
                }
            });
            return hasInvalidOrigin ? helpers.error('string.uri') : value;
        }),
        otherwise: Joi.string().default(''),
    }),
    OTP_SECRET: Joi.string().min(32).optional(),
    EMAILJS_OTP_TEMPLATE_ID: Joi.string().trim().optional(),
    SUPABASE_URL: Joi.string().uri().required(),
    SUPABASE_SERVICE_ROLE_KEY: Joi.string().trim().min(1).required(),
});