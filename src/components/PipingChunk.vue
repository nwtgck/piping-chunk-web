<template>
  <v-layout>
    <v-flex xs12 sm6 offset-sm3 offset-md3 md6>
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
  </v-layout>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import { createWriteStream } from 'streamsaver';
import * as pipingChunk from '@/piping-chunk';
import * as utils from '@/utils';
import * as aes128gcmStream from 'aes128gcm-stream';

import vueFilePond from 'vue-filepond';
import 'filepond/dist/filepond.min.css';


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

  private async send() {
    // Get file in FilePond
    const pondFile: {file: File} | null = (this.$refs.pond as any).getFile();
    if (pondFile === null) {
      console.error('Error: No first file');
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
    // Save as file streamingly
    const downloadPromise: Promise<void> = downloadStream.pipeTo(createWriteStream(filename));

    downloadPromise.finally(() => {
      // Disable indeterminate because finished
      this.progressSetting.indeterminate = false;
      // Set percentage as 100%
      this.progressSetting.percentage    = 100;
      // Enable the button again
      this.enableActionButton = true;
    });
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
</style>
