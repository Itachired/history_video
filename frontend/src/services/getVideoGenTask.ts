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

import type { GetVideoGenTaskResponse } from '@/types/video_gen_task';
import axios, { type AxiosRequestConfig } from 'axios';

export interface GetVideoGenTaskParams {
  Id: string;
  ProjectId?: string;
  Index?: number;
}

export type GetVideoGenTaskResult = GetVideoGenTaskResponse & {
  local_asset?: Record<string, unknown>;
};

type Request = (
  params: GetVideoGenTaskParams,
) => Promise<GetVideoGenTaskResult>;

export const GetVideoGenTask: Request = async params => {
  const searchParams = new URLSearchParams();
  if (params.ProjectId) {
    searchParams.set('project_id', params.ProjectId);
  }
  if (typeof params.Index === 'number') {
    searchParams.set('index', String(params.Index));
  }
  const query = searchParams.toString();
  const url = `http://127.0.0.1:8889/v1/video-tasks/${params.Id}${query ? `?${query}` : ''}`;
  const axiosConfig: AxiosRequestConfig = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    url,
  };

  try {
    const result = await axios(axiosConfig);
    return result.data;
  } catch (error: unknown) {
    return Promise.reject(error);
  }
};
