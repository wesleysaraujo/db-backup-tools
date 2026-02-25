<template>
  <div class="app">
    <header class="header">
      <div>
        <h1>DB Backup Tools</h1>
        <p>Frontend Vue para gerenciar conexões, backups e agendamentos.</p>
      </div>
      <div class="config">
        <label>
          API Base URL
          <input v-model.trim="baseUrl" type="text" placeholder="http://localhost:3777" />
        </label>
        <label>
          API Key
          <input v-model.trim="apiKey" type="password" placeholder="Bearer token" />
        </label>
        <button class="secondary" @click="refreshAll">Recarregar dados</button>
      </div>
    </header>

    <div v-if="message" :class="['message', messageType]">
      {{ message }}
    </div>

    <section class="card">
      <h2>Conexões</h2>
      <form class="grid" @submit.prevent="createConnection">
        <label>
          Nome
          <input v-model.trim="connectionForm.name" type="text" required />
        </label>
        <label>
          Tipo
          <select v-model="connectionForm.type">
            <option value="mysql">MySQL</option>
            <option value="postgresql">PostgreSQL</option>
          </select>
        </label>
        <label>
          Host
          <input v-model.trim="connectionForm.host" type="text" required />
        </label>
        <label>
          Porta
          <input v-model.number="connectionForm.port" type="number" min="1" />
        </label>
        <label>
          Usuario
          <input v-model.trim="connectionForm.username" type="text" required />
        </label>
        <label>
          Senha
          <input v-model="connectionForm.password" type="password" required />
        </label>
        <label>
          Database
          <input v-model.trim="connectionForm.database" type="text" required />
        </label>
        <div class="actions">
          <button type="submit">Criar conexão</button>
        </div>
      </form>

      <div class="list">
        <div v-for="connection in connections" :key="connection.id" class="list-item">
          <div>
            <strong>{{ connection.name }}</strong>
            <div class="muted">{{ connection.type }} - {{ connection.host }}:{{ connection.port }} / {{ connection.database }}</div>
          </div>
          <div class="actions">
            <button class="secondary" @click="testConnection(connection.id)">Testar</button>
            <button class="secondary" @click="runBackup(connection.id)">Backup agora</button>
            <button class="danger" @click="deleteConnection(connection.id)">Remover</button>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Backups</h2>
      <div class="tabs">
        <button
          v-for="status in backupStatuses"
          :key="status.value"
          :class="['tab', { active: backupTab === status.value }]"
          @click="backupTab = status.value"
        >
          {{ status.label }}
        </button>
      </div>
      <div class="grid">
        <label>
          Filtrar por conexão
          <select v-model="backupFilterConnectionId" @change="loadBackups">
            <option value="">Todas</option>
            <option v-for="connection in connections" :key="connection.id" :value="connection.id">
              {{ connection.name }}
            </option>
          </select>
        </label>
        <label>
          Limite de linhas (backup manual)
          <input v-model.number="backupRowLimit" type="number" min="1" placeholder="Opcional" />
        </label>
        <label>
          Itens por pagina
          <select v-model.number="backupPageSize">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
          </select>
        </label>
        <div class="actions">
          <button class="secondary" @click="loadBackups">Atualizar lista</button>
        </div>
      </div>
      <div class="list">
        <div v-for="backup in paginatedBackups" :key="backup.id" class="list-item">
          <div class="backup-info">
            <div class="backup-primary">
              <strong>{{ backup.filename }}</strong>
              <div class="muted">{{ backup.connectionName }} · {{ backup.database }}</div>
            </div>
            <div class="backup-meta">
              <div>
                <span class="label">Data</span>
                {{ formatDate(backup.completedAt || backup.startedAt) }}
              </div>
              <div>
                <span class="label">Tamanho</span>
                {{ formatSize(backup.sizeBytes) }}
              </div>
              <div>
                <span class="label">Status</span>
                <span :class="['status', backup.status]">{{ getStatusLabel(backup) }}</span>
              </div>
            </div>
            <div v-if="backup.status === 'failed' && backup.errorMessage" class="muted">
              {{ backup.errorMessage }}
            </div>
          </div>
          <div class="actions">
            <button class="secondary" @click="downloadBackup(backup)">Download</button>
            <button class="danger" @click="deleteBackup(backup)">Remover</button>
          </div>
        </div>
      </div>
      <div class="pagination">
        <span class="muted">{{ paginationLabel }}</span>
        <div class="actions">
          <button class="secondary" :disabled="backupPage === 1" @click="backupPage -= 1">Anterior</button>
          <button class="secondary" :disabled="backupPage >= totalBackupPages" @click="backupPage += 1">Proxima</button>
        </div>
      </div>
      <div class="restore-card">
        <div>
          <h3>Restaurar backup</h3>
          <p class="muted">Apenas backups concluídos aparecem na lista.</p>
        </div>
        <form class="grid" @submit.prevent="restoreBackup">
          <label>
            Backup
            <select v-model="restoreForm.backupId" required>
              <option value="" disabled>Selecione</option>
              <option v-for="backup in completedBackups" :key="backup.id" :value="backup.id">
                {{ backup.filename }}
              </option>
            </select>
          </label>
          <label>
            Restaurar para conexão
            <select v-model="restoreForm.connectionId" required>
              <option value="" disabled>Selecione</option>
              <option v-for="connection in connections" :key="connection.id" :value="connection.id">
                {{ connection.name }}
              </option>
            </select>
          </label>
          <div class="actions">
            <button type="submit" class="danger">Restaurar backup</button>
          </div>
        </form>
      </div>
    </section>

    <section class="card">
      <h2>Agendamentos</h2>
      <form class="grid" @submit.prevent="createSchedule">
        <label>
          conexão
          <select v-model="scheduleForm.connectionId" required>
            <option value="" disabled>Selecione</option>
            <option v-for="connection in connections" :key="connection.id" :value="connection.id">
              {{ connection.name }}
            </option>
          </select>
        </label>
        <label>
          Cron
          <input v-model.trim="scheduleForm.cronExpression" type="text" placeholder="0 2 * * *" required />
        </label>
        <label class="inline">
          <input v-model="scheduleForm.enabled" type="checkbox" />
          Ativo
        </label>
        <div class="actions">
          <button type="submit">Criar agendamento</button>
        </div>
      </form>

      <div class="list">
        <div v-for="schedule in schedules" :key="schedule.id" class="list-item">
          <div>
            <strong>{{ getConnectionName(schedule.connectionId) }}</strong>
            <div class="muted">{{ schedule.cronExpression }} - {{ schedule.enabled ? 'Ativo' : 'Pausado' }}</div>
          </div>
          <div class="actions">
            <button class="secondary" @click="toggleSchedule(schedule)">
              {{ schedule.enabled ? 'Pausar' : 'Ativar' }}
            </button>
            <button class="danger" @click="deleteSchedule(schedule.id)">Remover</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';

const baseUrl = ref(localStorage.getItem('dbBackupApiBase') ?? 'http://localhost:3777');
const apiKey = ref(localStorage.getItem('dbBackupApiKey') ?? '');
const message = ref('');
const messageType = ref('info');

const connections = ref([]);
const backups = ref([]);
const schedules = ref([]);

const backupStatuses = [
  { value: 'completed', label: 'Concluidos' },
  { value: 'failed', label: 'Falharam' },
  { value: 'running', label: 'Em execucao' },
  { value: 'pending', label: 'Pendentes' },
];
const backupTab = ref('completed');
const backupPage = ref(1);
const backupPageSize = ref(10);
const completedBackups = computed(() => backups.value.filter(backup => backup.status === 'completed'));
const displayedBackups = computed(() => backups.value.filter(backup => backup.status === backupTab.value));
const totalBackupPages = computed(() => Math.max(1, Math.ceil(displayedBackups.value.length / backupPageSize.value)));
const paginatedBackups = computed(() => {
  const start = (backupPage.value - 1) * backupPageSize.value;
  return displayedBackups.value.slice(start, start + backupPageSize.value);
});
const paginationLabel = computed(() => {
  const total = displayedBackups.value.length;
  if (total === 0) return 'Nenhum backup encontrado.';
  const start = (backupPage.value - 1) * backupPageSize.value + 1;
  const end = Math.min(backupPage.value * backupPageSize.value, total);
  return `Mostrando ${start}-${end} de ${total}`;
});

const connectionForm = reactive({
  name: '',
  type: 'mysql',
  host: '',
  port: 3306,
  username: '',
  password: '',
  database: '',
});

const backupFilterConnectionId = ref('');
const backupRowLimit = ref(null);
const restoreForm = reactive({
  backupId: '',
  connectionId: '',
});

const scheduleForm = reactive({
  connectionId: '',
  cronExpression: '',
  enabled: true,
});

watch(baseUrl, value => {
  localStorage.setItem('dbBackupApiBase', value);
});

watch(apiKey, value => {
  localStorage.setItem('dbBackupApiKey', value);
});

watch(backupTab, () => {
  backupPage.value = 1;
});

watch(backupPageSize, () => {
  backupPage.value = 1;
});

watch(displayedBackups, () => {
  if (backupPage.value > totalBackupPages.value) {
    backupPage.value = totalBackupPages.value;
  }
});

function setMessage(type, text) {
  messageType.value = type;
  message.value = text;
}

async function requestJson(path, options = {}) {
  const normalizedBase = baseUrl.value.replace(/\/$/, '');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (apiKey.value) {
    headers.Authorization = `Bearer ${apiKey.value}`;
  }
  const response = await fetch(`${normalizedBase}${path}`, {
    ...options,
    headers,
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || 'Erro na requisicao');
  }
  return payload.data;
}

async function refreshAll() {
  await Promise.all([loadConnections(), loadBackups(), loadSchedules()]);
}

async function loadConnections() {
  try {
    connections.value = await requestJson('/api/connections');
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function createConnection() {
  try {
    const payload = {
      ...connectionForm,
      port: connectionForm.port || undefined,
    };
    await requestJson('/api/connections', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setMessage('success', 'conexão criada com sucesso.');
    connectionForm.name = '';
    connectionForm.host = '';
    connectionForm.username = '';
    connectionForm.password = '';
    connectionForm.database = '';
    await loadConnections();
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function deleteConnection(id) {
  try {
    await requestJson(`/api/connections/${id}`, { method: 'DELETE' });
    setMessage('success', 'conexão removida.');
    await loadConnections();
    await loadSchedules();
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function testConnection(id) {
  try {
    const result = await requestJson(`/api/connections/${id}/test`, { method: 'POST' });
    const text = result.reachable ? 'conexão OK.' : `Falha na conexão: ${result.error || ''}`;
    setMessage(result.reachable ? 'success' : 'error', text);
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function runBackup(connectionId) {
  try {
    const body = backupRowLimit.value ? { rowLimit: backupRowLimit.value } : undefined;
    await requestJson(`/api/backups/${connectionId}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    setMessage('success', 'Backup executado.');
    await loadBackups();
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function loadBackups() {
  try {
    backupPage.value = 1;
    const query = backupFilterConnectionId.value
      ? `?connectionId=${backupFilterConnectionId.value}`
      : '';
    backups.value = await requestJson(`/api/backups${query}`);
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function downloadBackup(backup) {
  try {
    const normalizedBase = baseUrl.value.replace(/\/$/, '');
    const headers = apiKey.value ? { Authorization: `Bearer ${apiKey.value}` } : {};
    const response = await fetch(`${normalizedBase}/api/backups/${backup.id}/download`, {
      headers,
    });
    if (!response.ok) {
      let errorMessage = 'Falha no download';
      try {
        const payload = await response.json();
        if (payload?.error) {
          errorMessage = payload.error;
        }
      } catch (error) {
        errorMessage = error.message || errorMessage;
      }
      throw new Error(errorMessage);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backup.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function deleteBackup(backup) {
  const confirmed = window.confirm(`Remover o backup ${backup.filename}?`);
  if (!confirmed) return;
  try {
    await requestJson(`/api/backups/${backup.id}`, { method: 'DELETE' });
    setMessage('success', 'Backup removido.');
    await loadBackups();
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function restoreBackup() {
  try {
    await requestJson(`/api/backups/${restoreForm.backupId}/restore`, {
      method: 'POST',
      body: JSON.stringify({
        connectionId: restoreForm.connectionId,
        confirm: true,
      }),
    });
    setMessage('success', 'Restore executado com sucesso.');
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function loadSchedules() {
  try {
    schedules.value = await requestJson('/api/schedules');
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function createSchedule() {
  try {
    await requestJson('/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        connectionId: scheduleForm.connectionId,
        cronExpression: scheduleForm.cronExpression,
        enabled: scheduleForm.enabled,
      }),
    });
    setMessage('success', 'Agendamento criado.');
    scheduleForm.connectionId = '';
    scheduleForm.cronExpression = '';
    scheduleForm.enabled = true;
    await loadSchedules();
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function toggleSchedule(schedule) {
  try {
    await requestJson(`/api/schedules/${schedule.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !schedule.enabled }),
    });
    await loadSchedules();
  } catch (error) {
    setMessage('error', error.message);
  }
}

async function deleteSchedule(id) {
  try {
    await requestJson(`/api/schedules/${id}`, { method: 'DELETE' });
    setMessage('success', 'Agendamento removido.');
    await loadSchedules();
  } catch (error) {
    setMessage('error', error.message);
  }
}

function getConnectionName(id) {
  const connection = connections.value.find(item => item.id === id);
  return connection ? connection.name : id;
}

function formatSize(sizeBytes) {
  if (sizeBytes === null || sizeBytes === undefined) return 'N/A';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = sizeBytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getStatusLabel(backup) {
  switch (backup.status) {
    case 'completed':
      return 'Concluido';
    case 'running':
      return 'Em execucao';
    case 'failed':
      return 'Falhou';
    case 'pending':
      return 'Pendente';
    default:
      return backup.status;
  }
}

onMounted(async () => {
  await refreshAll();
});
</script>
