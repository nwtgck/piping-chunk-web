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

export async function getBodyBytesFromResponse(res: Response): Promise<Uint8Array> {
  if (res.body === null) {
    return new Uint8Array();
  }
  const reader = res.body.getReader();
  const arrays = [];
  let totalLen = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) { break; }
    totalLen += value.byteLength;
    arrays.push(value);
  }
  // (from: https://qiita.com/hbjpn/items/dc4fbb925987d284f491)
  const allArray = new Uint8Array(totalLen);
  let pos = 0;
  for (const arr of arrays) {
    allArray.set(arr, pos);
    pos += arr.byteLength;
  }
  return allArray;
}

// (from: https://stackoverflow.com/a/40031979/2885946)
export function buffToHex(buff: ArrayBuffer): string {
  return Array.prototype.map.call(new Uint8Array(buff), (x) => ('00' + x.toString(16)).slice(-2)).join('');
}

export async function sha256(input: string): Promise<string> {
  return buffToHex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
  );
}

// (from: https://gist.github.com/kawanet/352a2ed1d1656816b2bc)
export function stringToArrayBuffer(str: string): ArrayBuffer {
  const numbers: number[] = [].map.call(str, (c: string) => {
    return c.charCodeAt(0);
  }) as any; // TODO: Not use any
  return new Uint8Array(numbers).buffer;
}

export function arrayBufferToString(arr: ArrayBuffer) {
  return String.fromCharCode(... new Uint8Array(arr));
}
