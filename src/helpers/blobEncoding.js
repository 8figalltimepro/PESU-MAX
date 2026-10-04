// Slice and chunk sizes must stay multiples of 3 so only the final chunk carries base64 padding.
const BLOB_SLICE_BYTES = 3 * 256 * 1024;
const CHAR_CODE_CHUNK_BYTES = 3 * 8 * 1024;

function bytesToBase64(bytes) {
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += CHAR_CODE_CHUNK_BYTES) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHAR_CODE_CHUNK_BYTES));
  }

  return btoa(binary);
}

export async function blobToDataUrl(blob, mimeType) {
  const parts = [`data:${mimeType};base64,`];

  for (let offset = 0; offset < blob.size; offset += BLOB_SLICE_BYTES) {
    const slice = blob.slice(offset, offset + BLOB_SLICE_BYTES);
    parts.push(bytesToBase64(new Uint8Array(await slice.arrayBuffer())));
  }

  return parts.join('');
}
