export interface SearchHistoryItem {
  term: string;
  timestamp: string;
}

export interface DeviceInfo {
  device_type?: string;
  os_version?: string;
  model?: string;
  platform?: "ios" | "android";
}
