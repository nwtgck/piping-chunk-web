// (from: https://vuetifyjs.com/en/framework/icons#icons)
import 'material-design-icons-iconfont/dist/material-design-icons.css';
import Vue from 'vue';
import App from './App.vue';
import './registerServiceWorker';
import Vuetify from 'vuetify';
import 'vuetify/dist/vuetify.min.css';
import vuetify from './plugins/vuetify';

// (from: https://e-joint.jp/474/)
import '@fortawesome/fontawesome';
import '@fortawesome/fontawesome-free-brands';

Vue.config.productionTip = false;

Vue.use(Vuetify);

new Vue({
  vuetify,
  render: (h) => h(App),
}).$mount('#app');
