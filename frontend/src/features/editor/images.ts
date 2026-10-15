export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法加载，请重新导入或生成。'))
    image.src = src
  })
}

export async function fitImage(src: string): Promise<string> {
  const image = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 1024, 1024)
  const scale = Math.min(1024 / image.width, 1024 / image.height)
  const width = image.width * scale, height = image.height * scale
  context.drawImage(image, (1024 - width) / 2, (1024 - height) / 2, width, height)
  return canvas.toDataURL('image/png')
}

export async function importImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。')
  if (file.size > 12_000_000) throw new Error('图片不能超过 12 MB。')
  const url = URL.createObjectURL(file)
  try { return await fitImage(url) } finally { URL.revokeObjectURL(url) }
}

export function downloadImage(image: string) {
  const anchor = document.createElement('a')
  anchor.href = image
  anchor.download = `conveditor-${Date.now()}.png`
  anchor.click()
}

// Original vector sketch: a starting drawing, never presented as an AI result.
export const sampleImage = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect width="1024" height="1024" fill="white"/>
<g fill="none" stroke="#c8d8de" stroke-width="2" stroke-dasharray="10 9"><ellipse cx="510" cy="324" rx="149" ry="148"/><path d="M485 162Q550 413 505 573T515 852M351 322L669 334M304 500L689 481"/><ellipse cx="500" cy="571" rx="96" ry="154"/></g>
<g stroke="#364751" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
<path fill="#fff" d="M371 299Q339 199 373 129L451 219Q508 194 557 217L638 135Q670 222 635 306L620 382Q577 443 512 445Q427 433 382 383Z"/>
<path fill="#e8eeef" d="M384 245L380 162L431 225M575 230L630 170L625 263"/>
<path fill="none" d="M381 296L424 279L449 299M553 294L594 275L625 292M466 342Q502 371 539 338M504 360L504 381M483 383Q508 398 529 380"/>
<ellipse fill="#364751" cx="444" cy="324" rx="8" ry="13"/><ellipse fill="#364751" cx="568" cy="318" rx="8" ry="13"/>
<path fill="#364751" d="M486 350L519 350L504 364Z"/>
<path fill="#edbb9e" d="M427 420Q506 450 592 415L583 466Q509 487 428 464ZM579 460L684 476L652 506L561 476Z"/>
<path fill="#fff" d="M428 467L379 511L350 601L388 622L433 553L425 686Q498 729 580 679L570 547L635 576L660 540L587 469"/>
<path fill="none" d="M430 674L447 494M449 495Q522 534 577 592M484 490L498 689M508 550L539 550"/>
<path fill="#e8eeef" d="M524 578L592 578L600 666L522 672Z"/>
<path fill="#fff" d="M350 600L331 631L353 654L385 622M634 577L657 594L680 573L661 540M430 690L414 803L460 814L501 726L531 809L582 802L577 685"/>
<path fill="#e8eeef" d="M416 802L397 839L468 840L461 812M530 805L530 838L608 836L580 801"/>
<path fill="#fff" d="M581 690Q738 740 741 576Q831 749 641 774L580 752"/>
<path fill="none" d="M725 651L755 669L733 688"/>
</g><g fill="none" stroke="#a9bcc5" stroke-width="2"><path d="M348 862Q509 876 651 859M346 294Q333 234 352 195M391 519L364 591M604 737Q693 768 728 719"/></g>
</svg>`)
