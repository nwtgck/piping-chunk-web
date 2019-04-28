export function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const fileReader = new FileReader();
    fileReader.readAsArrayBuffer(blob);
    fileReader.onload = () => {
      const arrayBuffer = fileReader.result as ArrayBuffer;
      resolve(new Uint8Array(arrayBuffer));
    };
  });
}

export function createFileReadableStream(file: File, chunkSize: number): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      // NOTE: Use await at least once otherwise blocking
      for (let pos = 0; pos < file.size; pos += chunkSize) {
        // Decide end position
        const end: number = ( pos + chunkSize < file.size ) ? pos + chunkSize : file.size;
        // Read sliced file
        const blob: Blob        = file.slice(pos, end);
        // Convert blob to Uint8Array
        const chunk: Uint8Array = await blobToUint8Array(blob);
        // Enqueue the chunk
        controller.enqueue(chunk);
      }
      // Finish
      controller.close();
    },
  });
}

export function getPregressReadableStream(
  readableStream: ReadableStream<Uint8Array>,
  onCurrentSize: (currentSize: number) => void,
): ReadableStream<Uint8Array> {

  let currentSize = 0;
  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk, controller) => {
      controller.enqueue(chunk);
      currentSize += chunk.byteLength;
      onCurrentSize(currentSize);
    },
  });

  return readableStream.pipeThrough(transformStream);
}

export async function passphraseToKey(passphrase: string): Promise<Uint8Array> {
  // Convert passphrase string to Uint8Array
  const passphraseU8Array: Uint8Array = new TextEncoder().encode(passphrase);
  // Generate key from passphrase by SHA-2156
  const key = new Uint8Array(await crypto.subtle.digest('SHA-256', passphraseU8Array));
  return key;
}
