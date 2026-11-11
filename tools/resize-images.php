<?php
// Resizes card images for the web with PHP's GD extension (no other image tools needed).
//   php -d extension=gd tools/resize-images.php <manifest.json>
// manifest: { "max": 640, "quality": 82, "files": [ { "in": "...", "out": "....jpg" } ] }
// Every output is a JPEG no larger than max x max, on white where the source was transparent.
// Prints one JSON line per file: { in, out, w, h, bytes } or { in, error }.
declare(strict_types=1);

if (!function_exists('imagecreatetruecolor')) {
    fwrite(STDERR, "PHP's GD extension is not loaded. Run with: php -d extension=gd ...\n");
    exit(2);
}
$m = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
$max = (int) ($m['max'] ?? 640);
$quality = (int) ($m['quality'] ?? 82);

foreach ($m['files'] as $f) {
    $in = $f['in'];
    $info = @getimagesize($in);
    $src = match ($info[2] ?? 0) {
        IMAGETYPE_JPEG => @imagecreatefromjpeg($in),
        IMAGETYPE_PNG => @imagecreatefrompng($in),
        IMAGETYPE_GIF => @imagecreatefromgif($in),
        IMAGETYPE_WEBP => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($in) : false,
        default => false,
    };
    if (!$src) {
        echo json_encode(['in' => $in, 'error' => 'unreadable image']), "\n";
        continue;
    }
    [$w, $h] = [imagesx($src), imagesy($src)];
    $scale = min(1, $max / max($w, $h));
    [$nw, $nh] = [max(1, (int) round($w * $scale)), max(1, (int) round($h * $scale))];
    $dst = imagecreatetruecolor($nw, $nh);
    imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    imageinterlace($dst, true);
    @mkdir(dirname($f['out']), 0777, true);
    imagejpeg($dst, $f['out'], $quality);
    echo json_encode(['in' => $in, 'out' => $f['out'], 'w' => $nw, 'h' => $nh, 'bytes' => filesize($f['out'])]), "\n";
}
