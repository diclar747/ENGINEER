import fs from 'fs';
import path from 'path';
import { config } from '../config';

export class StorageService {
  private static uploadDir = config.storage.uploadDir;

  public static initialize(): void {
    const dirs = [
      this.uploadDir,
      path.join(this.uploadDir, 'ci_documents'),
      path.join(this.uploadDir, 'medical_studies'),
      path.join(this.uploadDir, 'qr_stickers'),
      path.join(this.uploadDir, 'exports'),
      path.join(this.uploadDir, 'logos'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    console.log(`📁 Storage Service initialized at: ${this.uploadDir}`);
  }

  public static async saveFile(
    folder: 'ci_documents' | 'medical_studies' | 'qr_stickers' | 'exports' | 'logos',
    filename: string,
    buffer: Buffer
  ): Promise<{ fileUrl: string; localPath: string }> {
    const targetDir = path.join(this.uploadDir, folder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, filename);
    await fs.promises.writeFile(filePath, buffer);

    const fileUrl = `${config.baseUrl}/uploads/${folder}/${filename}`;
    return { fileUrl, localPath: filePath };
  }

  public static async getFile(folder: string, filename: string): Promise<Buffer | null> {
    const filePath = path.join(this.uploadDir, folder, filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.promises.readFile(filePath);
  }

  public static async deleteFile(filePath: string): Promise<boolean> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch (err) {
      console.error(`Failed to delete file ${filePath}:`, err);
      return false;
    }
  }

  /**
   * Physically purges all files belonging to a specific user (GDPR / LGPD)
   */
  public static async purgeUserData(userId: string): Promise<number> {
    let deletedCount = 0;
    const folders = ['ci_documents', 'medical_studies', 'qr_stickers', 'exports'];

    for (const folder of folders) {
      const folderPath = path.join(this.uploadDir, folder);
      if (fs.existsSync(folderPath)) {
        const files = await fs.promises.readdir(folderPath);
        for (const file of files) {
          if (file.includes(userId)) {
            const fullPath = path.join(folderPath, file);
            await fs.promises.unlink(fullPath);
            deletedCount++;
          }
        }
      }
    }
    return deletedCount;
  }
}
