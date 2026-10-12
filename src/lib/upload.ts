export function uploadWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress(percent);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }

      const detail = xhr.responseText || `HTTP ${xhr.status}`;
      if (detail.includes("maximum allowed size") || xhr.status === 413) {
        reject(
          new Error(
            "Upload bloqueado pelo limite do Storage. Confira o Global file size limit e o limite do bucket activity-videos no Supabase.",
          ),
        );
        return;
      }
      reject(new Error(`Falha no upload de ${file.name}: ${detail}`));
    };

    xhr.onerror = () => reject(new Error(`Falha de rede no upload de ${file.name}.`));
    xhr.onabort = () => reject(new Error(`Upload de ${file.name} cancelado.`));

    xhr.send(file);
  });
}
