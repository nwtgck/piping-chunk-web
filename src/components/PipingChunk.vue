<template>
  <v-layout>
    <v-flex xs12 sm6 offset-sm3 offset-md3 md6>
      <v-card style="padding: 1em;">

        <v-btn-toggle v-model="sendOrGet" mandatory style="margin-bottom: 2em;">
          <v-btn flat value="send">
            Send
          </v-btn>
          <v-btn flat value="get">
            Get
          </v-btn>
        </v-btn-toggle>

        <send-file v-if="sendOrGet === 'send'" />
        <get-file v-if="sendOrGet === 'get'" />
      </v-card>
    </v-flex>
  </v-layout>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import SendFile from '@/components/SendFile.vue';
import GetFile from '@/components/GetFile.vue';


@Component({
  components: {
    SendFile,
    GetFile,
  },
})
export default class PipingChunk extends Vue {
  private sendOrGet: 'send' | 'get' = 'send';
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
</style>
