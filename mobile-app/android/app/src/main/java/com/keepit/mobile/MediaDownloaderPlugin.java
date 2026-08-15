package com.keepit.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import kotlin.Unit;

@CapacitorPlugin(name = "MediaDownloader")
public class MediaDownloaderPlugin extends Plugin {
    private static final String PREFERENCES = "keepit_downloader";
    private static final String LAST_UPDATE_KEY = "last_successful_update";
    private static final long UPDATE_INTERVAL_MS = 24L * 60L * 60L * 1000L;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String activeProcessId;

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "").trim();
        final String format = call.getString("format", "mp3").toLowerCase(Locale.US);

        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("Enter a valid web address.");
            return;
        }
        if (!format.equals("mp3") && !format.equals("mp4")) {
            call.reject("Unsupported download format.");
            return;
        }
        if (activeProcessId != null) {
            call.reject("A download is already running.");
            return;
        }

        activeProcessId = UUID.randomUUID().toString();
        final String processId = activeProcessId;
        emitProgress(0f, 0L, "preparing");

        worker.execute(() -> {
            File downloadedFile = null;
            try {
                YoutubeDL.getInstance().init(getContext());
                FFmpeg.getInstance().init(getContext());
                updateDownloaderIfNeeded();

                File workDir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "KeepIt");
                if (!workDir.exists() && !workDir.mkdirs()) {
                    throw new IllegalStateException("Unable to prepare local storage.");
                }
                clearWorkingDirectory(workDir);

                YoutubeDLRequest request = new YoutubeDLRequest(url);
                request.addOption("--no-playlist");
                request.addOption("--newline");
                request.addOption("--restrict-filenames");
                request.addOption("--embed-metadata");
                request.addOption("--extractor-args", "youtube:player_client=android_vr");
                request.addOption("-o", new File(workDir, "%(title).160B-%(id)s.%(ext)s").getAbsolutePath());
                request.addOption("--print", "after_move:__KEEPIT_FILE__%(filepath)s");

                if (format.equals("mp3")) {
                    request.addOption("-x");
                    request.addOption("--audio-format", "mp3");
                    request.addOption("--audio-quality", "0");
                } else {
                    request.addOption("-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best");
                    request.addOption("--merge-output-format", "mp4");
                }

                YoutubeDLResponse response = YoutubeDL.getInstance().execute(
                    request,
                    processId,
                    (progress, etaSeconds, line) -> {
                        emitProgress(progress, etaSeconds, "downloading");
                        return Unit.INSTANCE;
                    }
                );

                downloadedFile = outputFromResponse(response.getOut(), workDir);
                if (downloadedFile == null || !downloadedFile.exists()) {
                    throw new IllegalStateException("The downloaded file could not be located.");
                }

                Uri publishedUri = publishToDownloads(downloadedFile, format);
                JSObject result = new JSObject();
                result.put("fileName", downloadedFile.getName());
                result.put("format", format);
                result.put("sizeBytes", downloadedFile.length());
                result.put("uri", publishedUri.toString());
                emitProgress(100f, 0L, "complete");
                call.resolve(result);
            } catch (YoutubeDL.CanceledException canceled) {
                call.reject("Download cancelled.", "CANCELLED");
            } catch (Exception error) {
                String message = readableError(error);
                call.reject(message, "DOWNLOAD_FAILED", error);
            } finally {
                if (downloadedFile != null && downloadedFile.exists()) {
                    // The public copy is managed by MediaStore; the working copy is temporary.
                    downloadedFile.delete();
                }
                if (processId.equals(activeProcessId)) {
                    activeProcessId = null;
                }
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String processId = activeProcessId;
        if (processId != null) {
            YoutubeDL.getInstance().destroyProcessById(processId);
            activeProcessId = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void openDownloads(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(
                Uri.parse("content://com.android.providers.downloads.documents/root/downloads"),
                "resource/folder"
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception ignored) {
            Intent fallback = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            fallback.setType("*/*");
            fallback.addCategory(Intent.CATEGORY_OPENABLE);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
            call.resolve();
        }
    }

    private void emitProgress(float progress, long etaSeconds, String status) {
        JSObject event = new JSObject();
        event.put("progress", Math.max(0, Math.min(100, Math.round(progress))));
        event.put("etaSeconds", Math.max(0, etaSeconds));
        event.put("status", status);
        notifyListeners("downloadProgress", event);
    }

    private File outputFromResponse(String output, File workDir) {
        if (output != null) {
            for (String line : output.split("\\R")) {
                int marker = line.indexOf("__KEEPIT_FILE__");
                if (marker >= 0) {
                    File candidate = new File(line.substring(marker + "__KEEPIT_FILE__".length()).trim());
                    if (candidate.exists()) return candidate;
                }
            }
        }

        File[] files = workDir.listFiles(File::isFile);
        if (files == null || files.length == 0) return null;
        return Arrays.stream(files).max(Comparator.comparingLong(File::lastModified)).orElse(null);
    }

    private Uri publishToDownloads(File source, String format) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, source.getName());
        values.put(MediaStore.Downloads.MIME_TYPE, format.equals("mp3") ? "audio/mpeg" : "video/mp4");
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/KeepIt");
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("Android could not create the Downloads entry.");

        try (FileInputStream input = new FileInputStream(source); OutputStream output = resolver.openOutputStream(uri)) {
            if (output == null) throw new IllegalStateException("Android could not open the Downloads entry.");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
            }
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        }

        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        return uri;
    }

    private void clearWorkingDirectory(File workDir) {
        File[] files = workDir.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isFile()) file.delete();
        }
    }

    private void updateDownloaderIfNeeded() {
        SharedPreferences preferences = getContext().getSharedPreferences(PREFERENCES, 0);
        long now = System.currentTimeMillis();
        long lastUpdate = preferences.getLong(LAST_UPDATE_KEY, 0L);
        if (now - lastUpdate < UPDATE_INTERVAL_MS) return;

        try {
            YoutubeDL.getInstance().updateYoutubeDL(
                getContext(),
                YoutubeDL.UpdateChannel.STABLE.INSTANCE
            );
            preferences.edit().putLong(LAST_UPDATE_KEY, now).apply();
        } catch (Exception ignored) {
            // Offline downloads can still use the bundled version when it remains compatible.
        }
    }

    private String readableError(Exception error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) return "The download could not be completed.";
        String firstLine = message.split("\\R", 2)[0].trim();
        if (firstLine.length() > 180) firstLine = firstLine.substring(0, 180) + "…";
        return firstLine;
    }

    @Override
    protected void handleOnDestroy() {
        String processId = activeProcessId;
        if (processId != null) YoutubeDL.getInstance().destroyProcessById(processId);
        worker.shutdownNow();
        super.handleOnDestroy();
    }
}
