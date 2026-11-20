// Original text-only fixture: a dense page exceeds the explicit context budget.
export function denseReadingPdf(){
 const lines=Array.from({length:95},(_,i)=>`BT /F1 7 Tf 30 ${760-i*7} Td (Synthetic line ${String(i).padStart(2,'0')}: bounded evidence must be visibly truncated, never silently expanded.) Tj ET`);
 const stream=lines.join('\n')+'\n';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let output='%PDF-1.4\n';const offsets=[];
 for(const [i,object]of objects.entries()){offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(output);
}
