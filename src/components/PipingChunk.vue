<template>
  <v-layout>
    <v-flex xs12 sm8 offset-sm2 offset-md3 md6>
      <v-card style="padding: 1em;">

        <v-btn-toggle v-model="sendOrGet" mandatory style="margin-bottom: 2em;">
          <v-btn flat value="send">
            Send
            <v-icon right dark>file_upload</v-icon>
          </v-btn>
          <v-btn flat value="get">
            Get
            <v-icon right dark>file_download</v-icon>
          </v-btn>
        </v-btn-toggle>

        <file-pond v-if="sendOrGet === 'send'"
                   ref="pond"
                   label-idle="<img src='img/file-icon.svg' style='width: 2em'><br>Drop a file here or <span class='filepond--label-action'>Browse</span>"
                   allow-multiple="false"
                   maxFiles="1"
        />
        <v-text-field label="Server URL"
                      v-model="serverUrl"
        />
        <v-text-field label="Data ID"
                      v-model="dataId"
                      placeholder="e.g. mydata"
        />
        <v-text-field label="Passphrase (optional)"
                      v-model="passphrase"
                      placeholder="Input passphrase"
                      :type="showPassphrase ? 'text' : 'password'"
                      :append-icon="showPassphrase ? 'visibility' : 'visibility_off'"
                      @click:append="showPassphrase = !showPassphrase"
        />
        <v-text-field label="Simultaneous requests"
                      v-model="nSimultaneousReqs"
                      type="number"
        />

        <v-text-field v-if="sendOrGet === 'send'"
                      label="Chunk bytes"
                      v-model="chunkByteSize"
                      type="number"
        />
        <v-btn v-if="sendOrGet === 'send'"
               color="primary"
               v-on:click="send()"
               block
               :disabled="!enableActionButton">
          Send
          <v-icon right dark>file_upload</v-icon>
        </v-btn>
        <v-alert :value="sendOrGet === 'get' && !streamDownloadSupported"
                 type="warning"
        >
          This browser does NOT support stream-download.<br>
          Whole file data will be temporary on the memory.
        </v-alert>
        <v-btn v-if="sendOrGet === 'get'"
               color="secondary"
               v-on:click="get()"
               block
               :disabled="!enableActionButton">
          Get
          <v-icon right dark>file_download</v-icon>
        </v-btn>
        <v-progress-linear
          v-show="progressSetting.show"
          :indeterminate="progressSetting.indeterminate"
          :value="progressSetting.percentage"
        />
      </v-card>
    </v-flex>
    <v-snackbar v-model="showsSnackbar"
                color="error">
      {{ snackbarMessage }}
    </v-snackbar>
  </v-layout>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as streamSaver from 'streamsaver'; // NOTE: load before streams polyfill to detect support
import * as fileSaver from 'file-saver';
import * as pipingChunk from '@/piping-chunk';
import * as utils from '@/utils';
import * as aes128gcmStream from 'aes128gcm-stream';

import vueFilePond from 'vue-filepond';
import 'filepond/dist/filepond.min.css';


(async () => {
  try {
    const _ = TransformStream;
  } catch (err) {
    // Detect ReferenceError
    // Use polyfill
    const webStreamsPolyfill = await import('web-streams-polyfill');
    ReadableStream  = webStreamsPolyfill.ReadableStream;
    WritableStream  = webStreamsPolyfill.WritableStream;
    TransformStream = webStreamsPolyfill.TransformStream;
  }
})();

// Create component
const FilePond = vueFilePond();

@Component({
  components: {
    FilePond,
  },
})
export default class PipingChunk extends Vue {
  private sendOrGet: 'send' | 'get' = 'send';
  private dataId: string = '';
  private passphrase: string = '';
  private showPassphrase: boolean = false;
  // TODO: Hard code
  private serverUrl: string = 'https://ppng.ml';
  private nSimultaneousReqs: number = 2;
  private chunkByteSize: number = 65536; // NOTE: About 65KB
  // Progress bar setting
  private progressSetting: {show: boolean, indeterminate: boolean, percentage: number} = {
    show: false,
    indeterminate: false,
    percentage: 0,
  };
  // Whether send/get button is available
  private enableActionButton: boolean = true;
  // Show snackbar
  private showsSnackbar: boolean = false;
  // Message of snackbar
  private snackbarMessage: string = '';
  // Whether stream-download is supported
  private readonly streamDownloadSupported = streamSaver.supported;

  // Show error message
  private showSnackbar(message: string): void {
    this.showsSnackbar = true;
    this.snackbarMessage = message;
  }

  private async send() {
    // Get file in FilePond
    const pondFile: {file: File} | null = (this.$refs.pond as any).getFile();
    if (pondFile === null) {
      // Show error message
      this.showSnackbar('Error: No file selected');
      return;
    }
    // If Data ID is empty
    if (this.dataId === '') {
      // Show error message
      this.showSnackbar('Error: Data ID is required');
      return;
    }
    // Disable the button
    this.enableActionButton = false;
    // Get the file
    const file: File = pondFile.file;

    // Create ReadableStream from a file
    const fileReadableStream = utils.createFileReadableStream(file, this.chunkByteSize);

    // Get total size
    const totalSize: number = file.size;
    // Show progress bar
    this.progressSetting.show = true;
    // Disable indeterminate always
    this.progressSetting.indeterminate = false;
    // Set initial percentage
    this.progressSetting.percentage = 0;

    // Stream for progress bar
    const progressStream: ReadableStream<Uint8Array> =
      utils.getPregressReadableStream(fileReadableStream, (currentSize) => {
        this.progressSetting.percentage = (currentSize / totalSize) * 100;
      });

    // Create upload stream
    const uploadStream: ReadableStream<Uint8Array> = await (async () => {
      // If passphrase is empty
      if (this.passphrase === '') {
        return progressStream;
      } else {
        // Generate key from passphrase by SHA-2156
        const key = await utils.passphraseToKey(this.passphrase);
        // Encrypt
        return aes128gcmStream.encryptStream(
          progressStream,
          key,
        );
      }
    })();

    // Send
    const sendPromise: Promise<void> = pipingChunk.sendReadableStream(
      uploadStream,
      this.nSimultaneousReqs,
      this.serverUrl,
      this.dataId,
    );

    sendPromise.finally(() => {
      // Enable the button again
      this.enableActionButton = true;
    });
  }

  private async get(): Promise<void> {
    // If Data ID is empty
    if (this.dataId === '') {
      // Show error message
      this.showSnackbar('Error: Data ID is required');
      return;
    }
    // Disable the button
    this.enableActionButton = false;

    // Show progress bar
    this.progressSetting.show = true;
    // Enable indeterminate because it does NOT has percentage
    this.progressSetting.indeterminate = true;

    // Create get-readable-stream
    const readableStream = pipingChunk.getReadableStream(
      this.nSimultaneousReqs,
      this.serverUrl,
      this.dataId,
    );


    // Create download stream
    const downloadStream: ReadableStream<Uint8Array> = await (async () => {
      // If passphrase is empty
      if (this.passphrase === '') {
        return readableStream;
      } else {
        // Generate key from passphrase by SHA-2156
        const key = await utils.passphraseToKey(this.passphrase);
        return aes128gcmStream.decryptStream(
          readableStream,
          key,
        );
      }
    })();

    // Use data ID as file name
    const filename = this.dataId;

    // If stream-download is supported
    if (streamSaver.supported) {
      // Save as file streamingly
      await downloadStream.pipeTo(
        streamSaver.createWriteStream(filename),
      );
    } else {
      // Read up chunks and generate blob
      const chunks: Uint8Array[] = [];
      const reader = downloadStream.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
      }
      // Create a blob from chunks
      const blob = new Blob(chunks);
      // Save
      fileSaver.saveAs(blob, filename);
    }

    // Disable indeterminate because finished
    this.progressSetting.indeterminate = false;
    // Set percentage as 100%
    this.progressSetting.percentage    = 100;
    // Enable the button again
    this.enableActionButton = true;
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
</style>
