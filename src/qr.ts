// QR codes for the room page's share dialog (WeChat: scan the code with the phone to pass the room on).
// room.html calls window.RentletQR(text) and puts the SVG it returns into the dialog.
import qrcode from 'qrcode-generator';

declare global {
  interface Window {
    RentletQR: (text: string) => string;
  }
}

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

window.RentletQR = qrSvg;
