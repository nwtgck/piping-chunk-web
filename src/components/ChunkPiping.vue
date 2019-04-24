<template>
  <div>
    <input type="file" ref="inputFile"><br>
    <input type="text" v-model="serverUrl" placeholder="Server URL"><br>
    <input type="text" v-model="dataId" placeholder="Data ID"><br>
    <button v-on:click="send()">Send</button>
    <button v-on:click="get()">Get</button>
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import {PromiseLimiter} from '@/promise-limiter';
import {PromiseSequentialContext} from '@/promise-sequential-context';

function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const fileReader = new FileReader();
    fileReader.readAsArrayBuffer(blob);
    fileReader.onload = () => {
      const arrayBuffer = fileReader.result as ArrayBuffer;
      resolve(new Uint8Array(arrayBuffer));
    };
  });
}

function createFileReadableStream(file: File, chunkSize: number): ReadableStream<Uint8Array> {
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

@Component
export default class ChunkPiping extends Vue {
  private dataId: string = '';
  private serverUrl: string = 'http://localhost:8080';

  private async send() {
    const files: FileList | null = (this.$refs.inputFile as HTMLInputElement).files;
    if (files === null) {
      console.error('Error: No file list');
      return;
    }
    const file: File | null = files.item(0);
    if (file === null) {
      console.error('Error: No first file');
      return;
    }

    // TODO: hard code number
    const promiseLimiter = new PromiseLimiter(2);
    // TODO: Hard code: chunk size
    // NOTE: About 65KB
    const reader = createFileReadableStream(file, 65536).getReader();
    // NOTE: Be careful if you move chunkNum definition outside of this for loop
    //       because chunkNum is used in a asynchronous callback
    for (let chunkNum = 1; ;) {
      const {done, value: chunk} = await reader.read();

      await promiseLimiter.run(async () => {
        // Send a chunk
        const res = await fetch(`${this.serverUrl}/${this.dataId}/${chunkNum}`, {
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
          const res = await fetch(`${this.serverUrl}/${this.dataId}/${chunkNum}`, {
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

  private async* getGenerator(): AsyncIterable<{promise: Promise<Uint8Array>}> {
    // TODO: hard code number
    const promiseLimiter = new PromiseLimiter(2);

    // NOTE: Infinite loop without break
    // NOTE: Be careful if you move chunkNum definition outside of this for loop
    //       because chunkNum is used in a asynchronous callback
    for (let chunkNum = 1; ; chunkNum++) {
      console.log('chunk', chunkNum);
      const {promise: chunkPromise} = await promiseLimiter.run(async () => {
        const res = await fetch(`${this.serverUrl}/${this.dataId}/${chunkNum}`);
        if (res.body === null) {
          console.error('Error: res.body === null');
          return Uint8Array.from([]);
        }

        // Get all chunks
        // NOTE: whole body is not too big because whole body is also a chunk.
        const chunks: Uint8Array[] = [];
        let totalLength: number = 0;
        await res.body.pipeTo(new WritableStream<Uint8Array>({
          write: (chunk) => {
            chunks.push(chunk);
            totalLength += chunk.byteLength;
          },
        }));
        // Get whole bytes
        // (from: https://qiita.com/hbjpn/items/dc4fbb925987d284f491)
        const wholeBytes = new Uint8Array(totalLength);
        let pos = 0;
        for (const chunk of chunks) {
          wholeBytes.set(chunk, pos);
          pos += chunk.byteLength;
        }
        return wholeBytes;
      });

      yield {promise: chunkPromise};
    }
  }

  private async get() {
    // Get as blob
    // NOTE: This is not efficient because all data should be on memory. Find a way to save data as a file streamingly
    const blob: Blob = await new Promise(async (resolve) => {
      const psc = new PromiseSequentialContext();
      const chunks: Uint8Array[] = [];

      for await (const {promise} of this.getGenerator()) {
        // NOTE: Should not use await if use it, chunks are downloaded sequentially.
        psc.run(async () => {
          const chunk: Uint8Array = await promise;
          // Chunk finish
          if (chunk.byteLength === 0) {
            // (base: https://stackoverflow.com/a/19328891/2885946)
            resolve(new Blob(chunks, {type : 'octet/stream'}));
          }
          chunks.push(chunk);
        });
      }
    });

    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl);
    window.URL.revokeObjectURL(blobUrl);
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h3 {
  margin: 40px 0 0;
}
ul {
  list-style-type: none;
  padding: 0;
}
li {
  display: inline-block;
  margin: 0 10px;
}
a {
  color: #42b983;
}
</style>
