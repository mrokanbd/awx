import { QRCodeReader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } from '@zxing/library';

const qrReader = new QRCodeReader();

self.onmessage = function (event) {
    const { imageDataBuffer, width, height } = event.data;

    try {
        const rgbaData = new Uint8ClampedArray(imageDataBuffer);
        const pixelCount = width * height;
        const luminances = new Uint8ClampedArray(pixelCount);

        for (let i = 0; i < pixelCount; i++) {
            const offset = i * 4;
            luminances[i] = (rgbaData[offset] + rgbaData[offset + 1] * 2 + rgbaData[offset + 2]) >> 2;
        }

        const luminanceSource = new RGBLuminanceSource(luminances, width, height);
        const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
        const result = qrReader.decode(binaryBitmap);

        self.postMessage({ success: true, text: result.getText() });
    } catch (_) {
        // পড়া না গেলে পরের ফ্রেমে আবার চেষ্টা করবে
    }
};
