import { ref } from 'vue';
import { ESPLoader, Transport } from 'esptool-js';
import { useSerialPort, emit } from './useSerialPort';

export type FlashPart = { data: Uint8Array; address: number };

export type FlashPhase = 'idle' | 'connecting' | 'writing' | 'done' | 'failed';

// main() handshakes with the ROM loader at 115200, then negotiates up to this.
const WRITE_BAUD = 460800;

const phase = ref<FlashPhase>('idle');
const progress = ref(0);
const chip = ref<string | null>(null);
const error = ref<string | null>(null);

// esptool-js reports out of band — none of this arrives over the port, which is
// speaking binary to the ROM loader at the time.
const terminal = {
  clean: () => {},
  write: (data: string) => { if (data.trim()) emit('flash', data.trim()); },
  writeLine: (data: string) => { if (data.trim()) emit('flash', data.trim()); },
};

export function useEspFlasher() {
  const { claim } = useSerialPort();

  async function flash(parts: FlashPart[]): Promise<boolean> {
    if (!parts.length) throw new Error('Nothing to flash');
    phase.value = 'connecting';
    progress.value = 0;
    error.value = null;

    const total = parts.reduce((n, p) => n + p.data.length, 0);
    const written = new Map<number, number>();

    try {
      await claim('flash', async (port) => {
        const transport = new Transport(port, false);
        const loader = new ESPLoader({
          transport,
          baudrate: WRITE_BAUD,
          terminal,
        });
        try {
          chip.value = await loader.main();
          phase.value = 'writing';
          await loader.writeFlash({
            fileArray: parts,
            flashMode: 'keep',
            flashFreq: 'keep',
            flashSize: 'keep',
            eraseAll: false,
            compress: true,
            reportProgress: (fileIndex, bytes) => {
              written.set(fileIndex, bytes);
              const done = [...written.values()].reduce((n, v) => n + v, 0);
              progress.value = total ? Math.min(1, done / total) : 0;
            },
          });
          // Without this the board sits in the ROM loader until it's unplugged.
          await loader.after();
        } finally {
          await transport.disconnect();
        }
      });
      phase.value = 'done';
      progress.value = 1;
      return true;
    } catch (e) {
      error.value = (e as Error).message;
      emit('flash', `Failed: ${error.value}`);
      phase.value = 'failed';
      return false;
    }
  }

  return { flash, phase, progress, chip, error };
}
