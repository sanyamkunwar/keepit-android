import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeDownloadFormat = "mp3" | "mp4";

export type NativeDownloadResult = {
  fileName: string;
  format: NativeDownloadFormat;
  sizeBytes: number;
  uri: string;
};

export type NativeDownloadProgress = {
  progress: number;
  etaSeconds: number;
  status: "preparing" | "downloading" | "complete";
};

type MediaDownloaderPlugin = {
  download(options: { url: string; format: NativeDownloadFormat }): Promise<NativeDownloadResult>;
  cancel(): Promise<void>;
  openDownloads(): Promise<void>;
  addListener(
    eventName: "downloadProgress",
    listener: (event: NativeDownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
};

export const MediaDownloader = registerPlugin<MediaDownloaderPlugin>("MediaDownloader");
