import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";
import { initializeAdminWorkspace } from "./admin.js?v=20261110-4";

const $ = (id) => document.getElementById(id);
const screenIds = ["login-screen", "change-screen", "dashboard-screen"];
let currentProfile = null;
let supabase = null;

function show(screenId) {
  for (const id of screenIds) $(id).classList.toggle("hidden", id !== screenId);
}

function setBusy(button, busy, busyText) {
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.originalText;
}

function showLoginMessage(message = "") {
  $("login-error").textContent = "";
  $("login-info").textContent = message;
}

function isConfigured() {
  return SUPABASE_URL.startsWith("https://") &&
    SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");
}

async function showProfile(profile) {
  // A primeira versão operacional é restrita à superadmin.
  if (profile.role !== "superadmin") {
    await supabase.auth.signOut({ scope: "local" });
    currentProfile = null;
    show("login-screen");
    showLoginMessage("Nesta primeira versão, o acesso ao módulo de escalas está restrito à superadmin.");
    return;
  }

  currentProfile = profile;
  if (profile.must_change_password) {
    $("change-error").textContent = "";
    $("change-form").reset();
    show("change-screen");
    return;
  }
  renderDashboard();
}

function renderDashboard() {
  show("dashboard-screen");
  const name = currentProfile?.nome || "superadmin";
  $("dashboard-title").textContent = "Painel da superadmin";
  $("welcome-text").textContent = `Olá, ${name}. Aqui você administra as escalas das duas unidades.`;
  $("admin-content").classList.remove("hidden");
  $("tech-content").classList.add("hidden");
  $("dashboard-screen").classList.add("wide-dashboard");
  initializeAdminWorkspace(supabase).catch((error) => {
    console.error("Falha ao iniciar módulo administrativo:", error);
  });
}

async function fetchOwnProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, masp, nome, role, active, must_change_password")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error("Não foi possível consultar seu perfil.");
  if (!data || data.active !== true) {
    await supabase.auth.signOut({ scope: "local" });
    throw new Error("Conta inativa ou perfil não localizado. Procure a administração.");
  }
  return data;
}

async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    await supabase.auth.signOut({ scope: "local" });
    return;
  }

  try {
    const profile = await fetchOwnProfile(userData.user.id);
    await showProfile(profile);
  } catch (error) {
    show("login-screen");
    showLoginMessage(error.message);
  }
}

async function loginWithMasp(masp, password) {
  const endpoint = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/login-masp`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ masp, password }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Limite de tentativas atingido. Aguarde antes de tentar novamente.");
    }
    throw new Error(result.error || "MASP ou senha inválidos.");
  }

  if (!result.access_token || !result.refresh_token || !result.profile?.id) {
    throw new Error("Resposta de autenticação incompleta. Procure o administrador.");
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
  if (sessionError) throw new Error("Não foi possível iniciar a sessão. Tente novamente.");

  const profile = await fetchOwnProfile(result.profile.id);
  return profile;
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  showLoginMessage("");

  const masp = $("masp").value.trim();
  const password = $("password").value;
  if (!/^[0-9]{1,20}$/.test(masp)) {
    $("login-error").textContent = "Informe um MASP numérico válido.";
    return;
  }
  if (!password || password.length > 128) {
    $("login-error").textContent = "Informe sua senha.";
    return;
  }

  const button = $("login-submit");
  setBusy(button, true, "Autenticando...");
  try {
    const profile = await loginWithMasp(masp, password);
    $("login-form").reset();
    await showProfile(profile);
  } catch (error) {
    $("login-error").textContent = error.message || "Não foi possível realizar o login.";
  } finally {
    setBusy(button, false, "");
  }
});

$("change-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("change-error").textContent = "";
  const password = $("new-password").value;
  const confirmation = $("confirm-password").value;

  if (password.length < 12 || password.length > 128 || new TextEncoder().encode(password).length > 72) {
    $("change-error").textContent = "Use uma senha de 12 a 128 caracteres, com até 72 bytes.";
    return;
  }
  if (password === String(currentProfile?.masp ?? "")) {
    $("change-error").textContent = "A nova senha não pode ser igual ao MASP.";
    return;
  }
  if (password !== confirmation) {
    $("change-error").textContent = "As senhas não coincidem.";
    return;
  }

  const button = $("change-submit");
  setBusy(button, true, "Salvando...");
  try {
    const { data, error } = await supabase.functions.invoke(
      "change-initial-password",
      { body: { new_password: password } },
    );
    if (error || !data?.success) {
      let message = data?.error;
      if (!message && error?.context instanceof Response) {
        const body = await error.context.clone().json().catch(() => ({}));
        message = body.error;
      }
      throw new Error(message || "Não foi possível alterar a senha.");
    }

    await supabase.auth.signOut({ scope: "local" });
    currentProfile = null;
    $("change-form").reset();
    $("login-form").reset();
    show("login-screen");
    showLoginMessage("Senha alterada com sucesso. Entre novamente com sua nova senha.");
  } catch (error) {
    $("change-error").textContent = error.message || "Erro ao alterar a senha.";
  } finally {
    setBusy(button, false, "");
  }
});

$("logout").addEventListener("click", async () => {
  await supabase.auth.signOut({ scope: "local" });
  currentProfile = null;
  $("login-form").reset();
  show("login-screen");
  showLoginMessage("Você saiu do sistema.");
});

document.querySelectorAll("[data-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = $(button.dataset.toggle);
    input.type = input.type === "password" ? "text" : "password";
  });
});

async function start() {
  if (!isConfigured()) {
    $("login-error").textContent = "Configure a Project URL e a Publishable Key no arquivo config.js.";
    show("login-screen");
    return;
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage,
    },
  });

  await restoreSession();
}

start().catch((error) => {
  console.error("Falha na inicialização do portal:", error);
  $("login-error").textContent = "Não foi possível iniciar o portal. Atualize a página ou procure o administrador.";
  show("login-screen");
});
