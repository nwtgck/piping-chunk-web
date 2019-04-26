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
