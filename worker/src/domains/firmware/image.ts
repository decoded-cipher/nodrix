// What an uploaded .bin is, read from its own bytes.

export type ImageCheck =
  | { ok: true; chip: string | null }
  | { ok: false; code: 'not_an_esp_image' | 'merged_image'; reason: string };

const ESP_MAGIC = 0xe9;
const PARTITION_TABLE_OFFSET = 0x8000;
const PARTITION_MAGIC = [0xaa, 0x50];

// chip_id sits at byte 12 of esp_image_header_t. ESP8266 images have no such
// field, so an unknown id means "don't claim to know", not "wrong chip".
const CHIP_IDS: Record<number, string> = {
  0x0000: 'esp32',
  0x0002: 'esp32-s2',
  0x0005: 'esp32-c3',
  0x0009: 'esp32-s3',
  0x000c: 'esp32-c2',
  0x000d: 'esp32-c6',
  0x0010: 'esp32-h2',
};

export function inspectImage(body: ArrayBuffer): ImageCheck {
  const bytes = new Uint8Array(body);
  if (bytes.length < 24 || bytes[0] !== ESP_MAGIC) {
    return {
      ok: false,
      code: 'not_an_esp_image',
      reason: 'that file is not an ESP firmware image',
    };
  }

  // OTA writes to an app slot, so a whole-flash image would brick the board.
  if (
    bytes.length > PARTITION_TABLE_OFFSET + 1 &&
    bytes[PARTITION_TABLE_OFFSET] === PARTITION_MAGIC[0] &&
    bytes[PARTITION_TABLE_OFFSET + 1] === PARTITION_MAGIC[1]
  ) {
    return {
      ok: false,
      code: 'merged_image',
      reason: 'that is a merged flash image — upload the .ino.bin (app image) instead',
    };
  }

  const chipId = bytes[12]! | (bytes[13]! << 8);
  return { ok: true, chip: CHIP_IDS[chipId] ?? null };
}
