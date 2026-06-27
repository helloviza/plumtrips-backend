import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
  metadata?: {
    startTime: number;
    apiName: string;
  };
}

function generateCurl(config: CustomAxiosRequestConfig): string {
  const method = (config.method || 'GET').toUpperCase();
  const url = config.url || '';
  const baseURL = config.baseURL || '';
  const fullUrl = url.startsWith('http') ? url : `${baseURL}${url}`;
  
  let curl = `curl -X ${method} "${fullUrl}" \\\n`;
  
  const headers = config.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'common' || key.toLowerCase() === 'delete' || key.toLowerCase() === 'get' || key.toLowerCase() === 'head' || key.toLowerCase() === 'post' || key.toLowerCase() === 'put' || key.toLowerCase() === 'patch') {
      continue; // skip axios internal header objects
    }
    const safeValue = key.toLowerCase() === 'authorization' ? 'Bearer ***' : value;
    curl += `-H "${key}: ${safeValue}" \\\n`;
  }
  
  if (config.data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    const payloadStr = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
    const escapedPayload = payloadStr.replace(/'/g, "'\\''");
    curl += `-d '${escapedPayload}'`;
  } else {
    curl = curl.replace(/ \\\n$/, '');
  }
  
  return curl;
}

function summarizeResponse(data: any): string {
  if (!data) return 'No data';
  
  const summary: string[] = [];
  
  // Custom parsing for TBO structures
  if (data?.CityList) {
    summary.push(`Total Cities: ${data.CityList.length}`);
  }
  if (data?.HotelResult) {
    summary.push(`Total Hotels: ${data.HotelResult.length}`);
  }
  if (data?.TraceId || data?.traceId) {
    summary.push(`Trace ID: ${data.TraceId || data.traceId}`);
  }
  if (data?.HotelRoomsDetails) {
    summary.push(`Total Rooms: ${data.HotelRoomsDetails.length}`);
  }
  if (data?.BookingId || data?.BookId) {
    summary.push(`Booking ID: ${data.BookingId || data.BookId}`);
  }
  if (data?.Response?.Error?.ErrorMessage) {
    summary.push(`Error: ${data.Response.Error.ErrorMessage}`);
  }
  
  if (summary.length === 0) {
    if (Array.isArray(data)) {
      summary.push(`Array elements: ${data.length}`);
    } else if (typeof data === 'object') {
      summary.push(`Keys: ${Object.keys(data).slice(0, 5).join(', ')}`);
    } else {
      summary.push('Simple response');
    }
  }
  
  return summary.join(' | ');
}

export function attachLoggingInterceptor(axiosInstance: AxiosInstance, apiName: string) {
  if (process.env.DEBUG_API_LOGS !== 'true') {
    return;
  }

  axiosInstance.interceptors.request.use((config: CustomAxiosRequestConfig) => {
    config.metadata = { startTime: Date.now(), apiName };
    return config;
  }, (error) => {
    return Promise.reject(error);
  });

  axiosInstance.interceptors.response.use((response: AxiosResponse) => {
    const config = response.config as CustomAxiosRequestConfig;
    const durationMs = Date.now() - (config.metadata?.startTime || Date.now());
    
    logApi(config, response.status, response.data, durationMs, null);
    
    return response;
  }, (error: AxiosError) => {
    const config = error.config as CustomAxiosRequestConfig;
    const durationMs = Date.now() - (config.metadata?.startTime || Date.now());
    
    const status = error.response?.status || 'Network/Timeout';
    const responseData = error.response?.data || null;
    
    logApi(config, status, responseData, durationMs, error.message);
    
    return Promise.reject(error);
  });
}

function logApi(
  config: CustomAxiosRequestConfig, 
  status: string | number, 
  responseData: any, 
  durationMs: number,
  errorMessage: string | null
) {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  const durationStr = (durationMs / 1000).toFixed(1) + 's';
  const curlCmd = generateCurl(config);
  
  let summaryStr = errorMessage ? `Error: ${errorMessage}` : summarizeResponse(responseData);
  if (responseData && typeof responseData === 'object' && responseData.Response?.Error?.ErrorMessage) {
      summaryStr += ` | Provider Error: ${responseData.Response.Error.ErrorMessage}`;
  }

  const payloadStr = config.data ? JSON.stringify(config.data, null, 2) : 'None';
  const endpointName = config.url?.split('?')[0].split('/').pop() || '';
  const fullApiName = `${config.metadata?.apiName} ${endpointName}`.trim();

  const logLines = [
    '========================================',
    `API: ${fullApiName}`,
    `Timestamp: ${timestamp}`,
    `Method: ${(config.method || 'GET').toUpperCase()}`,
    `Endpoint: ${config.baseURL || ''}${config.url || ''}`,
    '',
    'Request Payload:',
    payloadStr,
    '',
    'Response Status:',
    String(status),
    '',
    'Response Summary:',
    summaryStr,
    '',
    'Response Time:',
    durationStr,
    '',
    'cURL:',
    curlCmd,
    '========================================'
  ];

  if (errorMessage || (typeof status === 'number' && status >= 400)) {
    console.error(logLines.join('\n'));
  } else {
    console.log(logLines.join('\n'));
  }
}
