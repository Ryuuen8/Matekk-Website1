// src/config/env.validation.ts
import Joi from 'joi';

export const envValidationSchema = Joi.object({
    NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
    JWT_SECRET: Joi.string().min(32).required(),
    JWT_EXPIRES_IN: Joi.string().default('15m'),
    OTP_SECRET: Joi.string().min(32).optional(),
    EMAILJS_OTP_TEMPLATE_ID: Joi.string().trim().optional(),
    SUPABASE_URL: Joi.string().uri().required(),
    SUPABASE_SERVICE_ROLE_KEY: Joi.string().trim().min(1).required(),
});