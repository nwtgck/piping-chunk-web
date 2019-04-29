<template>
  <div>
    <v-text-field
      label="Server URL"
      v-model="serverUrl"
    />
    <v-text-field
      label="Data ID"
      v-model="dataId"
      placeholder="e.g. mydata"
    />
    <v-text-field
      label="Passphrase (optional)"
      v-model="passphrase"
      placeholder="Input passphrase"
      :type="showPassphrase ? 'text' : 'password'"
      :append-icon="showPassphrase ? 'visibility' : 'visibility_off'"
      @click:append="showPassphrase = !showPassphrase"
    />
    <v-text-field
      label="Simultaneous requests"
      v-model="nSimultaneousReqs"
      type="number"
    />
    <v-btn color="secondary" v-on:click="get()" block :disabled="!enableGetButton">
      Get
      <v-icon right dark>file_download</v-icon>
    </v-btn>
    <v-progress-linear
      v-show="progressSetting.show"
      :indeterminate="progressSetting.indeterminate"
      :value="progressSetting.percentage"
    />
  </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import { createWriteStream } from 'streamsaver';
import * as pipingChunk from '@/piping-chunk';
import * as utils from '@/utils';
import * as aes128gcmStream from 'aes128gcm-stream';

@Component
export default class GetFile extends Vue {
  private dataId: string = '';
  private passphrase: string = '';
  private showPassphrase: boolean = false;
  // TODO: Hard code
  private serverUrl: string = 'https://ppng.ml';
  private nSimultaneousReqs: number = 2;
  // Progress bar setting
  private progressSetting: {show: boolean, indeterminate: boolean, percentage: number} = {
    show: false,
    indeterminate: false,
    percentage: 0,
  };
  // Whether get-button is available
  private enableGetButton: boolean = true;

  private async get(): Promise<void> {
    // Disable the button
    this.enableGetButton = false;

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
      this.enableGetButton = true;
    });
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
</style>
