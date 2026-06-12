const REFERENCE_IMAGE_UPLOAD_URL =
  'http://127.0.0.1:8889/v1/assets/upload-reference-image';

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const uploadReferenceImage = async (file: File) => {
  const data = await readFileAsDataUrl(file);
  const response = await fetch(REFERENCE_IMAGE_UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_name: file.name,
      content_type: file.type,
      data,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'upload reference image failed');
  }
  return (await response.json()) as { url: string; object_key: string };
};
