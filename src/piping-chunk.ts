import {PromiseLimiter} from 'promise-limiter';
import {PromiseSequentialContext} from '@/promise-sequential-context';
import urlJoin from 'url-join';
import * as utils from '@/utils';

export async function sendReadableStream(
  readableStream: ReadableStream,
  promiseLimit: number,
  serverUrl: string,
  pathPrefix: string): Promise<void> {
  // Create promise limiter
  const promiseLimiter = new PromiseLimiter(promiseLimit);
  // Get reader
  const reader = readableStream.getReader();
  // NOTE: Be careful if you move chunkNum definition outside of this for loop
  //       because chunkNum is used in a asynchronous callback
  for (let chunkNum = 1; ;) {
    const {done, value: chunk} = await reader.read();

    await promiseLimiter.run(async () => {
      // Send a chunk
      const res = await fetch(urlJoin(serverUrl, await utils.sha256(`${pathPrefix}/${chunkNum}`)), {
        method: 'POST',
        body: chunk,
      });
      if (res.body === null) {
        console.error('Unexpected: res.body === null');
        return;
      }
      // Wait for body being complete
      await res.body.pipeTo(new WritableStream({}));
    });

    // Increment chunk number
    chunkNum++;

    if (done) {
      await promiseLimiter.run(async () => {
        // Send a chunk
        const res = await fetch(urlJoin(serverUrl, await utils.sha256(`${pathPrefix}/${chunkNum}`)), {
          method: 'POST',
          body: '',
          headers: new Headers({
            'Content-Length': '0',
          }),
        });
        if (res.body === null) {
          return;
        }
        // Wait for body being complete
        await res.body.pipeTo(new WritableStream({}));
        console.log('last push finish', chunkNum);
      });
      break;
    }
  }
}

async function* getGenerator(
  promiseLimit: number,
  serverUrl: string,
  pathPrefix: string): AsyncIterable<{promise: Promise<Uint8Array>}> {
  // Create promise limiter
  const promiseLimiter = new PromiseLimiter(promiseLimit);

  // Whether chunks are finish or not
  let chunkDone = false;

  // NOTE: Infinite loop without break
  for (let chunkNum = 1; !chunkDone ; chunkNum++) {
    console.log('chunkNum', chunkNum);
    const {promise: chunkPromise} = await promiseLimiter.run(async () => {
      const res = await fetch(urlJoin(serverUrl, await utils.sha256(`${pathPrefix}/${chunkNum}`)));
      if (res.body === null) {
        console.error('Error: res.body === null');
        return Uint8Array.from([]);
      }

      // Get all chunks
      // NOTE: whole body is not too big because whole body is also a chunk.
      const chunks: Uint8Array[] = [];
      let totalLength: number = 0;
      const reader = res.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
        totalLength += value.byteLength;
      }
      // Get whole bytes
      // (from: https://qiita.com/hbjpn/items/dc4fbb925987d284f491)
      const wholeBytes = new Uint8Array(totalLength);
      let pos = 0;
      for (const chunk of chunks) {
        wholeBytes.set(chunk, pos);
        pos += chunk.byteLength;
      }

      // If whole bytes are 0
      if (wholeBytes.byteLength === 0) {
        // Set chunk-done flag on
        // NOTE: The future loop should be end. Of Course some useless processes are proceeded.
        chunkDone = true;
      }

      return wholeBytes;
    });

    yield {promise: chunkPromise};
  }
}


export function getReadableStream(promiseLimit: number, serverUrl: string, dataId: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const psc = new PromiseSequentialContext();
      for await (const {promise} of getGenerator(promiseLimit, serverUrl, dataId)) {
        // NOTE: Should not use await if use it, chunks are downloaded sequentially.
        psc.run(async () => {
          const chunk: Uint8Array = await promise;
          // Chunk finish
          if (chunk.byteLength === 0) {
            controller.close();
          } else {
            controller.enqueue(chunk);
          }
        });
      }
    },
  });
}
