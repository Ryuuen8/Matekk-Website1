import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service.js';

describe('EmailService', () => {
    let service: EmailService;
    let requestBody: Record<string, unknown> | undefined;

    beforeEach(() => {
        requestBody = undefined;
        const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return { ok: true };
        });
        vi.stubGlobal('fetch', fetchMock);
        service = new EmailService(new ConfigService({
            EMAILJS_SERVICE_ID: 'service-id',
            EMAILJS_PUBLIC_KEY: 'public-key',
            EMAILJS_PRIVATE_KEY: 'private-key',
            EMAILJS_USER_TEMPLATE_ID: 'registration-template',
            EMAILJS_OTP_TEMPLATE_ID: 'otp-template',
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends verification codes with the dedicated OTP template fields', async () => {
        await service.sendOtp('student@example.com', '012345', 5);

        expect(requestBody).toMatchObject({
            template_id: 'otp-template',
            template_params: {
                email: 'student@example.com',
                to_email: 'student@example.com',
                to_name: 'there',
                email_title: 'Your verification code',
                otp_code: '012345',
                expires_in_minutes: '5',
                from_name: 'Matekk Cybercore',
            },
        });
    });
});
