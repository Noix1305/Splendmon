# Lee las imágenes de img/backgrounds y genera img/backgrounds/fondos.js con la lista
# de fondos que muestra el juego. Ejecútalo cada vez que agregues o borres imágenes
# (doble clic en tools/actualizar-fondos.bat).
#
# El navegador no puede listar carpetas por sí solo, por eso hace falta este paso.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'img\backgrounds'
$out = Join-Path $dir 'fondos.js'
Add-Type -AssemblyName System.Drawing

function Get-WebpSize([byte[]]$bytes) {
  $b = [int[]]$bytes[0..31]  # en enteros: con bytes, -shl se desborda
  $kind = [Text.Encoding]::ASCII.GetString($bytes, 12, 4)
  switch ($kind) {
    'VP8X' { return @((1 + $b[24] + ($b[25] -shl 8) + ($b[26] -shl 16)), (1 + $b[27] + ($b[28] -shl 8) + ($b[29] -shl 16))) }
    'VP8 ' { return @((($b[26] + ($b[27] -shl 8)) -band 0x3FFF), (($b[28] + ($b[29] -shl 8)) -band 0x3FFF)) }
    'VP8L' {
      $bits = [int64]$b[21] + ([int64]$b[22] -shl 8) + ([int64]$b[23] -shl 16) + ([int64]$b[24] -shl 24)
      return @((($bits -band 0x3FFF) + 1), ((($bits -shr 14) -band 0x3FFF) + 1))
    }
  }
  return @(0, 0)
}

# Color promedio (para rellenar mientras carga la imagen). Solo PNG/JPG/GIF/BMP.
function Get-AverageColor($path) {
  $img = [System.Drawing.Bitmap]::new($path)
  try {
    $r = 0; $g = 0; $bl = 0; $n = 0
    $stepX = [Math]::Max(1, [int]($img.Width / 24)); $stepY = [Math]::Max(1, [int]($img.Height / 24))
    for ($y = 0; $y -lt $img.Height; $y += $stepY) { for ($x = 0; $x -lt $img.Width; $x += $stepX) {
      $c = $img.GetPixel($x, $y); $r += $c.R; $g += $c.G; $bl += $c.B; $n++
    } }
    return @(('#{0:x2}{1:x2}{2:x2}' -f [int]($r / $n), [int]($g / $n), [int]($bl / $n)), $img.Width, $img.Height)
  } finally { $img.Dispose() }
}

$list = @()
$files = Get-ChildItem $dir -File | Where-Object { $_.Extension -match '^\.(png|jpe?g|webp|gif|bmp|avif)$' } | Sort-Object Name
foreach ($f in $files) {
  $fill = '#1d1f24'; $w = 0; $h = 0
  # Se mira el contenido, no la extensión: un WebP renombrado a .jpg sigue siendo WebP.
  $head = New-Object byte[] 32
  $fs = [IO.File]::OpenRead($f.FullName); [void]$fs.Read($head, 0, 32); $fs.Close()
  $isWebp = [Text.Encoding]::ASCII.GetString($head, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($head, 8, 4) -eq 'WEBP'
  if ($isWebp) {
    $size = Get-WebpSize $head; $w = $size[0]; $h = $size[1]
  } elseif ($f.Extension -ne '.avif') {
    try { $info = Get-AverageColor $f.FullName; $fill = $info[0]; $w = $info[1]; $h = $info[2] } catch { }
  }
  $base = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  $slug = ($base.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
  $label = ($base -replace '[_-]+', ' ').Trim()
  $list += [ordered]@{
    id = 'img-' + $slug
    label = $label
    img = 'img/backgrounds/' + $f.Name
    fill = $fill
    width = $w
    height = $h
  }
}

$json = if ($list.Count) { ConvertTo-Json @($list) -Depth 3 } else { '[]' }
$js = "// Generado por tools/actualizar-fondos.ps1. No lo edites a mano: vuelve a ejecutar el script.`r`n" +
      "window.SM = window.SM || {};`r`nSM.BACKGROUND_IMAGES = $json;`r`n"
[IO.File]::WriteAllText($out, $js, [Text.UTF8Encoding]::new($false))

Write-Host "Fondos encontrados: $($list.Count)  ->  img\backgrounds\fondos.js"
foreach ($i in $list) {
  $warn = if ($i.width -and $i.width -lt 1600) { '  (pequena: se vera pixelada a pantalla completa)' } else { '' }
  Write-Host ("  {0,-40} {1,5} x {2,-5}{3}" -f $i.label, $i.width, $i.height, $warn)
}
