import { createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const zipPath = path.join(projectRoot, 'mini-tools-extension.zip');

const DOS_EPOCH = new Date('1980-01-01T00:00:00Z');
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTime(date) {
  const safeDate = date < DOS_EPOCH ? DOS_EPOCH : date;
  const year = safeDate.getFullYear();
  const month = safeDate.getMonth() + 1;
  const day = safeDate.getDate();
  const hours = safeDate.getHours();
  const minutes = safeDate.getMinutes();
  const seconds = Math.floor(safeDate.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

async function collectFiles(directory, baseDirectory = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, baseDirectory));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        zipName: path.relative(baseDirectory, absolutePath).split(path.sep).join('/'),
      });
    }
  }

  return files.sort((left, right) => left.zipName.localeCompare(right.zipName));
}

async function createZip(sourceDirectory, targetZipPath) {
  const files = await collectFiles(sourceDirectory);
  const output = createWriteStream(targetZipPath);
  const centralDirectoryRecords = [];
  let offset = 0;

  for (const file of files) {
    const fileBuffer = await import('node:fs/promises').then((fs) => fs.readFile(file.absolutePath));
    const fileStat = await stat(file.absolutePath);
    const compressedBuffer = zlib.deflateRawSync(fileBuffer);
    const checksum = crc32(fileBuffer);
    const fileNameBuffer = Buffer.from(file.zipName);
    const dosTime = toDosTime(fileStat.mtime);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(8),
      writeUInt16(dosTime.time),
      writeUInt16(dosTime.date),
      writeUInt32(checksum),
      writeUInt32(compressedBuffer.length),
      writeUInt32(fileBuffer.length),
      writeUInt16(fileNameBuffer.length),
      writeUInt16(0),
      fileNameBuffer,
    ]);

    output.write(localHeader);
    output.write(compressedBuffer);

    centralDirectoryRecords.push({
      checksum,
      compressedSize: compressedBuffer.length,
      uncompressedSize: fileBuffer.length,
      fileNameBuffer,
      dosTime,
      localHeaderOffset: offset,
    });

    offset += localHeader.length + compressedBuffer.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBuffers = centralDirectoryRecords.map((record) => Buffer.concat([
    writeUInt32(0x02014b50),
    writeUInt16(20),
    writeUInt16(20),
    writeUInt16(0x0800),
    writeUInt16(8),
    writeUInt16(record.dosTime.time),
    writeUInt16(record.dosTime.date),
    writeUInt32(record.checksum),
    writeUInt32(record.compressedSize),
    writeUInt32(record.uncompressedSize),
    writeUInt16(record.fileNameBuffer.length),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt32(0),
    writeUInt32(record.localHeaderOffset),
    record.fileNameBuffer,
  ]));
  const centralDirectory = Buffer.concat(centralDirectoryBuffers);

  output.write(centralDirectory);
  output.write(Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(centralDirectoryRecords.length),
    writeUInt16(centralDirectoryRecords.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(centralDirectoryOffset),
    writeUInt16(0),
  ]));

  await new Promise((resolve, reject) => {
    output.end(resolve);
    output.on('error', reject);
  });
}

await unlink(zipPath).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});

execFileSync('npm', ['run', 'build'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

await createZip(distDir, zipPath);

console.log(`插件目录：${distDir}`);
console.log(`插件压缩包：${zipPath}`);
