import { resolveBackendUrl } from '@/utils/desktopRuntime';
import { getAdminAuthHeaders } from '@/services/admin/authHeaders';

interface ReferenceImageUploadPayload {
  content_type: string;
  data: string;
  file_name: string;
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const isFile = (input: File | ReferenceImageUploadPayload): input is File =>
  typeof File !== 'undefined' && input instanceof File;

export const uploadReferenceImage = async (
  input: File | ReferenceImageUploadPayload,
) => {
  const payload = isFile(input)
    ? {
        file_name: input.name,
        content_type: input.type,
        data: await readFileAsDataUrl(input),
      }
    : input;
  const response = await fetch(
    resolveBackendUrl('/v1/assets/upload-reference-image'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAdminAuthHeaders(),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'upload reference image failed');
  }
  return (await response.json()) as { url: string; object_key: string };
};
