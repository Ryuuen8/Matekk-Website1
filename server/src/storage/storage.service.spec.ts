import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service.js';

const {
  createClientMock,
  storageFromMock,
  uploadMock,
  createSignedUrlsMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  storageFromMock: vi.fn(),
  uploadMock: vi.fn(),
  createSignedUrlsMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockResolvedValue({ error: null });
    createSignedUrlsMock.mockResolvedValue({ data: [], error: null });
    storageFromMock.mockReturnValue({
      upload: uploadMock,
      createSignedUrls: createSignedUrlsMock,
    });
    createClientMock.mockReturnValue({
      storage: { from: storageFromMock },
    });

    service = new StorageService(
      new ConfigService({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      }),
    );
  });

  it('returns the private storage path after uploading a question image', async () => {
    const image = Buffer.from('image');

    await expect(service.uploadQuestionImage(image, 'question-13.png')).resolves.toBe(
      'questions/question-13.png',
    );

    expect(storageFromMock).toHaveBeenCalledWith('question-images');
    expect(uploadMock).toHaveBeenCalledWith('questions/question-13.png', image, {
      contentType: 'image/png',
      upsert: false,
    });
  });

  it('creates signed URLs for unique private question image paths', async () => {
    const imagePath = 'questions/question-13.png';
    const signedUrl = 'https://storage.example/question-13.png?token=signed';
    createSignedUrlsMock.mockResolvedValue({
      data: [{ path: imagePath, signedUrl, error: null }],
      error: null,
    });

    await expect(
      service.createSignedQuestionImageUrls([imagePath, imagePath]),
    ).resolves.toEqual(new Map([[imagePath, signedUrl]]));

    expect(createSignedUrlsMock).toHaveBeenCalledWith([imagePath], 3600);
  });

  it('rejects image paths outside the private questions folder', async () => {
    await expect(service.createSignedQuestionImageUrls(['../private.png']))
      .rejects.toThrow('Question image paths must point to supported files in the questions folder.');
    expect(createSignedUrlsMock).not.toHaveBeenCalled();
  });
});
