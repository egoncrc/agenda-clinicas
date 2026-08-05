import { createApp } from "vue";
import { createPinia } from "pinia";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import { useAuthStore } from "@/stores/auth";

const app = createApp(App);
app.use(createPinia());

// Se resuelve si hay sesión activa (cookie) antes de montar el router, para
// que el guard de rutas no dependa de una carrera entre navegación y auth.
const auth = useAuthStore();
await auth.checkSession();

app.use(router);
app.mount("#app");
