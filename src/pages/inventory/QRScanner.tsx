import { useState, useRef, useEffect, useCallback } from 'react';
import { ScanLine, Camera, X, Package, Trash2, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import InventoryLayout from '@/components/inventory/InventoryLayout';
import { scanStockQr, adjustStock, getLabelUrl } from '@/utils/inventoryApi';
import type { StockItem } from '@/types/inventory';

export default function QRScanner() {
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scannedItem, setScannedItem] = useState<StockItem | null>(null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setScanning(true);
      scanFrame();
    } catch (err) {
      toast({ title: 'Camera access denied', description: 'Please allow camera access to scan QR codes.', variant: 'destructive' });
    }
  }

  async function scanFrame() {
    if (!videoRef.current || !canvasRef.current) {
      animationRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (video.readyState !== video.HAVE_ENOUGH_DATA || !ctx) {
      animationRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    try {
      // Dynamic import jsQR
      const jsQR = (await import('jsqr')).default;
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code) {
        // Extract QR code value - might be a URL or direct code
        let qrValue = code.data;
        // If it's a URL like .../scan/REM-xxx, extract the code
        const scanMatch = qrValue.match(/scan\/([A-Za-z0-9-]+)$/);
        if (scanMatch) qrValue = scanMatch[1];

        stopCamera();
        handleLookup(qrValue);
        return;
      }
    } catch {
      // jsQR not available or error, continue
    }

    animationRef.current = requestAnimationFrame(scanFrame);
  }

  async function handleLookup(code: string) {
    if (!code.trim()) return;
    setLoading(true);
    try {
      const item = await scanStockQr(code.trim());
      setScannedItem(item);
    } catch {
      toast({ title: 'Not found', description: `No stock item found for code: ${code}`, variant: 'destructive' });
      setScannedItem(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleScrap() {
    if (!scannedItem) return;
    try {
      await adjustStock({
        id: scannedItem.id,
        reason: 'Marked as scrapped via QR scan',
      });
      toast({ title: 'Item scrapped' });
      setScannedItem(null);
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  }

  return (
    <InventoryLayout>
      <div className="max-w-lg mx-auto space-y-6">
        <h1 className="text-2xl font-bold">QR Scanner</h1>

        {/* Camera scanner */}
        <Card>
          <CardContent className="pt-4">
            {scanning ? (
              <div className="relative">
                <video
                  ref={videoRef}
                  className="w-full rounded-lg bg-black"
                  playsInline muted
                />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 border-2 border-white rounded-lg opacity-50" />
                </div>
                <Button
                  variant="secondary" size="sm"
                  className="absolute top-2 right-2"
                  onClick={stopCamera}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button onClick={startCamera} className="w-full" variant="outline">
                <Camera className="h-4 w-4 mr-2" />
                Open Camera Scanner
              </Button>
            )}

            <div className="mt-4 flex gap-2">
              <Input
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                placeholder="Enter QR code manually..."
                onKeyDown={e => e.key === 'Enter' && handleLookup(manualCode)}
              />
              <Button onClick={() => handleLookup(manualCode)} disabled={!manualCode.trim() || loading}>
                {loading ? '...' : 'Look Up'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Scanned Item Details */}
        {scannedItem && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {scannedItem.material?.name || 'Unknown Material'}
                  {scannedItem.material?.thickness_mm ? ` — ${scannedItem.material.thickness_mm}mm` : ''}
                </CardTitle>
                <Badge variant={scannedItem.origin === 'remnant' ? 'outline' : 'secondary'}>
                  {scannedItem.origin}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500">Dimensions</p>
                  <p className="font-medium">
                    {scannedItem.width_mm && scannedItem.height_mm
                      ? `${scannedItem.width_mm} × ${scannedItem.height_mm} mm`
                      : '—'
                    }
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Remaining Area</p>
                  <p className="font-medium">
                    {scannedItem.remaining_area_mm2
                      ? `${(scannedItem.remaining_area_mm2 / 1_000_000).toFixed(3)} m²`
                      : '—'
                    }
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Status</p>
                  <Badge variant={scannedItem.status === 'available' ? 'secondary' : 'destructive'}>
                    {scannedItem.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-gray-500">Location</p>
                  <p className="font-medium">{scannedItem.location || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500">QR Code</p>
                  <p className="font-mono text-xs">{scannedItem.qr_code}</p>
                </div>
                <div>
                  <p className="text-gray-500">Received</p>
                  <p className="font-medium">{scannedItem.received_date || '—'}</p>
                </div>
                {scannedItem.material?.grade && (
                  <div>
                    <p className="text-gray-500">Grade</p>
                    <p className="font-medium">{scannedItem.material.grade}</p>
                  </div>
                )}
                {scannedItem.notes && (
                  <div className="col-span-2">
                    <p className="text-gray-500">Notes</p>
                    <p className="text-sm">{scannedItem.notes}</p>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <a href={getLabelUrl(scannedItem.id)} target="_blank" rel="noopener noreferrer" className="flex-1">
                  <Button variant="outline" className="w-full" size="sm">
                    <Package className="h-3 w-3 mr-1" />
                    Print Label
                  </Button>
                </a>
                {scannedItem.status === 'available' && (
                  <Button variant="destructive" size="sm" onClick={handleScrap}>
                    <Trash2 className="h-3 w-3 mr-1" />
                    Scrap
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </InventoryLayout>
  );
}
