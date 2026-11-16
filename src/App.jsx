import { useEffect, useRef, useState } from 'react';
import { loadLiteRt, loadAndCompile, Tensor } from '@litertjs/core';

const MODEL_SIZE = 320;

export default function App() {
    const videoRef = useRef(null);
    const overlayRef = useRef(null);
    const [status, setStatus] = useState('AI মডেল ও ক্যামেরা চালু হচ্ছে...');
    const [statusColor, setStatusColor] = useState('#fbbf24');
    const [results, setResults] = useState([]);

    useEffect(() => {
        let isMounted = true;
        let animationFrameId = null;
        let qrModel = null;
        let isProcessing = false;
        const foundCodes = new Set();

        const zxingWorker = new Worker(
            new URL('./workers/zxingWorker.js', import.meta.url),
            { type: 'module' }
        );

        zxingWorker.onmessage = (event) => {
            if (event.data.success && !foundCodes.has(event.data.text)) {
                foundCodes.add(event.data.text);
                if (isMounted) {
                    setResults((prev) => [event.data.text, ...prev]);
                }
            }
        };

        const modelCanvas = document.createElement('canvas');
        modelCanvas.width = MODEL_SIZE;
        modelCanvas.height = MODEL_SIZE;
        const modelCtx = modelCanvas.getContext('2d', { willReadFrequently: true });

        const cropCanvas = document.createElement('canvas');
        const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });

        async function initApp() {
            try {
                // রিলেটিভ পাথ দিয়ে Wasm ও মডেল লোড
                await loadLiteRt('./wasm/');

                const accelerator = 'gpu' in navigator ? 'webgpu' : 'wasm';
                qrModel = await loadAndCompile('./qr_model.tflite', { accelerator });

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
                });

                if (!isMounted || !videoRef.current) return;
                videoRef.current.srcObject = stream;

                videoRef.current.onloadedmetadata = () => {
                    overlayRef.current.width = videoRef.current.videoWidth;
                    overlayRef.current.height = videoRef.current.videoHeight;
                    setStatus(`সক্রিয় (${accelerator.toUpperCase()}) — ক্যামেরার সামনে QR কোড ধরুন`);
                    setStatusColor('#10b981');
                    processLoop();
                };
            } catch (err) {
                if (isMounted) {
                    setStatus('ত্রুটি: ' + err.message);
                    setStatusColor('#ef4444');
                }
            }
        }

        async function processLoop() {
            const video = videoRef.current;
            if (!isMounted || !video) return;

            if (!isProcessing && video.readyState === video.HAVE_ENOUGH_DATA && qrModel) {
                isProcessing = true;
                try {
                    await detectAndSend(video);
                } catch (e) {
                    console.error(e);
                }
                isProcessing = false;
            }
            animationFrameId = requestAnimationFrame(processLoop);
        }

        async function detectAndSend(video) {
            modelCtx.drawImage(video, 0, 0, MODEL_SIZE, MODEL_SIZE);
            const imgData = modelCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;

            const inputDetails = qrModel.getInputDetails();
            const isNHWC = inputDetails.shape === 3;
            const floatData = new Float32Array(1 * 3 * MODEL_SIZE * MODEL_SIZE);

            if (isNHWC) {
                for (let i = 0; i < MODEL_SIZE * MODEL_SIZE; i++) {
                    floatData[i * 3] = imgData[i * 4] / 255.0;
                    floatData[i * 3 + 1] = imgData[i * 4 + 1] / 255.0;
                    floatData[i * 3 + 2] = imgData[i * 4 + 2] / 255.0;
                }
            } else {
                for (let i = 0; i < MODEL_SIZE * MODEL_SIZE; i++) {
                    floatData[i] = imgData[i * 4] / 255.0;
                    floatData[MODEL_SIZE * MODEL_SIZE + i] = imgData[i * 4 + 1] / 255.0;
                    floatData[2 * MODEL_SIZE * MODEL_SIZE + i] = imgData[i * 4 + 2] / 255.0;
                }
            }

            const inputTensor = new Tensor(floatData, inputDetails.shape);
            const outputs = await qrModel.run([inputTensor]);
            const rawOutput = (await outputs.moveTo('wasm')).toTypedArray();

            const boxes = parseYOLOv8Boxes(rawOutput, video.videoWidth, video.videoHeight);
            const overlayCtx = overlayRef.current.getContext('2d');
            overlayCtx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);

            for (const box of boxes) {
                overlayCtx.strokeStyle = '#10b981';
                overlayCtx.lineWidth = 4;
                overlayCtx.strokeRect(box.x, box.y, box.w, box.h);

                const scale = 2;
                const cropW = Math.round(Math.max(120, box.w * scale));
                const cropH = Math.round(Math.max(120, box.h * scale));
                cropCanvas.width = cropW;
                cropCanvas.height = cropH;

                cropCtx.filter = 'contrast(165%) brightness(105%) grayscale(100%)';
                cropCtx.drawImage(video, box.x, box.y, box.w, box.h, 0, 0, cropW, cropH);

                const cropImg = cropCtx.getImageData(0, 0, cropW, cropH);
                zxingWorker.postMessage(
                    { imageDataBuffer: cropImg.data.buffer, width: cropW, height: cropH },
                    [cropImg.data.buffer]
                );
            }
        }

        initApp();

        return () => {
            isMounted = false;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            zxingWorker.terminate();
            if (videoRef.current?.srcObject) {
                videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
            }
        };
    }, []);

    return (
        <div style={{ background: '#0f172a', color: '#f8fafc', minHeight: '100vh', padding: '15px', textAlign: 'center', fontFamily: 'system-ui' }}>
            <h2 style={{ color: '#38bdf8', margin: '5px 0' }}>AI Multi-QR স্ক্যানার</h2>
            <p style={{ color: statusColor, fontSize: '14px' }}>{status}</p>

            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', border: '2px solid #334155', borderRadius: '12px', overflow: 'hidden' }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ display: 'block', width: '100%', maxWidth: '640px' }} />
                <canvas ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
            </div>

            <div style={{ margin: '12px 0' }}>
                <button
                    onClick={() => setResults([])}
                    style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
                >
                    লিস্ট পরিষ্কার করুন
                </button>
            </div>

            <div style={{ maxWidth: '640px', margin: '15px auto', textAlign: 'left' }}>
                <h3>শনাক্তকৃত QR কোড ({results.length}):</h3>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                    {results.map((item, idx) => (
                        <li key={idx} style={{ background: '#1e293b', borderLeft: '4px solid #10b981', padding: '10px 14px', marginBottom: '8px', borderRadius: '6px', wordBreak: 'break-all' }}>
                            {item}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

function parseYOLOv8Boxes(rawOutput, videoW, videoH) {
    const numBoxes = 2100;
    const boxes = [];

    for (let i = 0; i < numBoxes; i++) {
        const maxScore = Math.max(rawOutput[4 * numBoxes + i], rawOutput[5 * numBoxes + i]);
        if (maxScore < 0.5) continue;

        let cx = rawOutput[0 * numBoxes + i];
        let cy = rawOutput[1 * numBoxes + i];
        let w = rawOutput[2 * numBoxes + i];
        let h = rawOutput[3 * numBoxes + i];

        if (w <= 1.0 && h <= 1.0) {
            cx *= MODEL_SIZE;
            cy *= MODEL_SIZE;
            w *= MODEL_SIZE;
            h *= MODEL_SIZE;
        }

        const scaleX = videoW / MODEL_SIZE;
        const scaleY = videoH / MODEL_SIZE;
        const padW = w * 0.15;
        const padH = h * 0.15;

        const x = Math.max(0, (cx - (w + padW) / 2) * scaleX);
        const y = Math.max(0, (cy - (h + padH) / 2) * scaleY);
        const finalW = Math.min(videoW - x, (w + padW) * scaleX);
        const finalH = Math.min(videoH - y, (h + padH) * scaleY);

        boxes.push({ x, y, w: finalW, h: finalH, score: maxScore });
    }

    boxes.sort((a, b) => b.score - a.score);
    const selected = [];
    while (boxes.length > 0) {
        const best = boxes.shift();
        selected.push(best);
        for (let j = boxes.length - 1; j >= 0; j--) {
            if (calculateIoU(best, boxes[j]) >= 0.45) boxes.splice(j, 1);
        }
    }
    return selected;
}

function calculateIoU(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - inter;
    return union === 0 ? 0 : inter / union;
}
