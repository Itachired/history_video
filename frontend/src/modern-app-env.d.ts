// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// Licensed under the 【火山方舟】原型应用软件自用许可协议
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//     https://www.volcengine.com/docs/82379/1433703
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// <reference types='@modern-js/app-tools/types' />
/// <reference types='@modern-js/runtime/types' />
/// <reference types='@modern-js/runtime/types/router' />
/// <reference types="aws-sdk" />

interface DesktopRuntimeInfo {
  appVersion?: string;
  assetRoot?: string;
  backendOrigin: string;
  isElectron?: boolean;
  isPackaged?: boolean;
  platform?: string;
}

interface DesktopBackendStatus {
  backendOrigin: string;
  desktopReady?: boolean;
  message?: string;
  running: boolean;
}

interface DesktopConfig {
  masked?: Record<string, string>;
  runtime: {
    assetRoot: string;
    backendPort?: number;
  };
  status?: {
    configured: boolean;
    missing: string[];
  };
  volcengine: {
    apiKey: string;
    llmEndpointId: string;
    imageEndpointId: string;
    videoEndpointId: string;
    tosAccessKey: string;
    tosSecretKey: string;
    tosBucket: string;
    ttsAccessKey?: string;
    ttsAppKey?: string;
    ttsApiResourceId?: string;
    ttsBaseUrl?: string;
    ttsNamespace?: string;
    ttsSpeaker?: string;
  };
}

interface DesktopConfigTestResult {
  backend: DesktopBackendStatus;
  checks: Record<string, boolean>;
  configured: boolean;
  missing: string[];
}

interface DesktopScriptFile {
  fileName: string;
  path?: string;
  size: number;
  text: string;
}

interface DesktopReferenceImage {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  path?: string;
  size: number;
}

interface DesktopAPI {
  runtimeInfo: DesktopRuntimeInfo;
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  getBackendStatus: () => Promise<DesktopBackendStatus>;
  restartBackend: () => Promise<DesktopBackendStatus>;
  getConfig: () => Promise<DesktopConfig>;
  saveConfig: (config: DesktopConfig) => Promise<DesktopConfig>;
  saveConfigAndRestart: (
    config: DesktopConfig,
  ) => Promise<{ backend: DesktopBackendStatus; config: DesktopConfig }>;
  testConfig: (config?: DesktopConfig) => Promise<DesktopConfigTestResult>;
  selectScriptFile: () => Promise<DesktopScriptFile | null>;
  selectReferenceImage: () => Promise<DesktopReferenceImage | null>;
  selectAssetRoot: () => Promise<string | null>;
  openProjectFolder: (projectId: string) => Promise<string | undefined>;
  openLogsFolder: () => Promise<string | undefined>;
  openAdminWindow: () => Promise<{ ok: boolean }>;
  focusMainWindow: () => Promise<{ ok: boolean }>;
  saveUrlAsFile: (
    url: string,
    suggestedName?: string,
  ) => Promise<{ filePath: string } | null>;
  onBackendStatusChanged: (
    callback: (status: DesktopBackendStatus) => void,
  ) => () => void;
}

interface Window {
  desktopAPI?: DesktopAPI;
}
