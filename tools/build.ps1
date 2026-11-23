<#
  Builds the Arc-style Chrome themes and the taskbar icon.

  Usage (from the project folder):
    powershell -ExecutionPolicy Bypass -File tools\build.ps1

  Output:
    themes\<name>\manifest.json + images\*.png   -> load with chrome://extensions > Load unpacked
    icon\arc-chrome.ico + arc-chrome-256.png      -> taskbar icon

  To make your own variant, copy one of the entries in $Themes below,
  change the colours, and run the script again.
#>

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class ArcArt
{
    static double Smooth(double t) { return t * t * (3 - 2 * t); }

    // Colour at position t (0..1) along a list of evenly spaced stops.
    static void Sample(int[][] stops, double t, out double r, out double g, out double b)
    {
        if (t < 0) t = 0; if (t > 1) t = 1;
        double seg = t * (stops.Length - 1);
        int i = (int)Math.Floor(seg);
        if (i >= stops.Length - 1) i = stops.Length - 2;
        double f = Smooth(seg - i);
        r = stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f;
        g = stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f;
        b = stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f;
    }

    // Diagonal multi-stop gradient, a soft glow, and monochrome film grain,
    // which is how Arc's Space themes look. Chrome themes cannot do
    // gradients or grain themselves, so they are drawn into a PNG.
    public static void Gradient(string path, int w, int h, int[][] stops, double angleDeg,
                                int[] glow, double glowStrength, int grain, int seed)
    {
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        var buf = new byte[data.Stride * h];
        var rnd = new Random(seed);
        double a = angleDeg * Math.PI / 180.0;
        double dx = Math.Cos(a), dy = Math.Sin(a);
        // Project the corners so t spans exactly 0..1 across the image.
        double p0 = Math.Min(Math.Min(0, w * dx), Math.Min(h * dy, w * dx + h * dy));
        double p1 = Math.Max(Math.Max(0, w * dx), Math.Max(h * dy, w * dx + h * dy));
        double gx = w * 0.78, gy = h * 0.18, gr = Math.Max(w, h) * 0.55;

        for (int y = 0; y < h; y++)
        {
            int row = y * data.Stride;
            for (int x = 0; x < w; x++)
            {
                double t = ((x * dx + y * dy) - p0) / (p1 - p0);
                double r, g, b;
                Sample(stops, t, out r, out g, out b);

                if (glow != null && glowStrength > 0)
                {
                    double d = Math.Sqrt((x - gx) * (x - gx) + (y - gy) * (y - gy)) / gr;
                    double k = d < 1 ? Smooth(1 - d) * glowStrength : 0;
                    r += (glow[0] - r) * k; g += (glow[1] - g) * k; b += (glow[2] - b) * k;
                }

                if (grain > 0)
                {
                    // Triangular noise looks closer to film grain than flat noise.
                    double n = (rnd.NextDouble() + rnd.NextDouble() - 1.0) * grain;
                    r += n; g += n; b += n;
                }

                int o = row + x * 4;
                buf[o]     = Clamp(b);
                buf[o + 1] = Clamp(g);
                buf[o + 2] = Clamp(r);
                buf[o + 3] = 255;
            }
        }
        Marshal.Copy(buf, 0, data.Scan0, buf.Length);
        bmp.UnlockBits(data);
        bmp.Save(path, ImageFormat.Png);
        bmp.Dispose();
    }

    static byte Clamp(double v) { return (byte)(v < 0 ? 0 : v > 255 ? 255 : Math.Round(v)); }

    // The taskbar mark: an original "arch" (a nod to Arc's shape, not a copy of
    // its logo) painted in Chrome's red / yellow / green with a blue Chrome-style
    // centre dot.
    public static Bitmap Mark(int s)
    {
        var bmp = new Bitmap(s, s, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);

            float stroke = s * 0.20f;
            float pad = stroke / 2f + s * 0.06f;
            var box = new RectangleF(pad, pad + s * 0.02f, s - 2 * pad, s - 2 * pad);

            // Arch = top half of a circle continued straight down on both sides.
            using (var path = new GraphicsPath())
            {
                float cx = box.X + box.Width / 2f;
                float legBottom = s - pad;
                float arcTop = box.Y;
                float radius = box.Width / 2f;
                var circle = new RectangleF(box.X, arcTop, box.Width, box.Width);
                float centerY = arcTop + radius;
                path.AddLine(box.X, legBottom, box.X, centerY);
                path.AddArc(circle, 180, 180);
                path.AddLine(box.Right, centerY, box.Right, legBottom);

                using (var brush = new LinearGradientBrush(new PointF(box.X - 1, 0), new PointF(box.Right + 1, 0),
                                                           Color.Black, Color.Black))
                {
                    var blend = new ColorBlend();
                    blend.Colors = new[] {
                        Color.FromArgb(234, 67, 53),   // Chrome red
                        Color.FromArgb(234, 67, 53),
                        Color.FromArgb(251, 188, 4),   // Chrome yellow
                        Color.FromArgb(52, 168, 83),   // Chrome green
                        Color.FromArgb(52, 168, 83) };
                    blend.Positions = new[] { 0f, 0.18f, 0.5f, 0.82f, 1f };
                    brush.InterpolationColors = blend;
                    using (var pen = new Pen(brush, stroke))
                    {
                        pen.StartCap = LineCap.Round;
                        pen.EndCap = LineCap.Round;
                        pen.LineJoin = LineJoin.Round;
                        g.DrawPath(pen, path);
                    }
                }

                // Blue Chrome-style dot with a white ring, sitting inside the arch.
                float dot = s * 0.30f;
                float dotY = centerY + s * 0.04f;
                var ring = new RectangleF(cx - dot / 2f - s * 0.035f, dotY - dot / 2f - s * 0.035f,
                                          dot + s * 0.07f, dot + s * 0.07f);
                using (var white = new SolidBrush(Color.White)) g.FillEllipse(white, ring);
                using (var blue = new SolidBrush(Color.FromArgb(66, 133, 244)))
                    g.FillEllipse(blue, cx - dot / 2f, dotY - dot / 2f, dot, dot);
            }
        }
        return bmp;
    }

    // The Quasar browser's icon, made from the logo image the user supplied
    // (icon\quasar-logo-original.png): the white background becomes transparent,
    // the gold stays exactly the same, and soft edges stay smooth.
    public static string LogoPath;
    static Bitmap cleanLogo;

    static Bitmap CleanLogo()
    {
        if (cleanLogo != null) return cleanLogo;
        using (var src = new Bitmap(LogoPath))
        {
            int w = src.Width, h = src.Height;
            // The logo's gold = the average of its most solid (least white) pixels.
            int minB = 255;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { var c = src.GetPixel(x, y); if (c.A > 200 && c.B < minB) minB = c.B; }
            long r = 0, g = 0, b = 0, n = 0;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                var c = src.GetPixel(x, y);
                if (c.A > 200 && c.B <= minB + 12) { r += c.R; g += c.G; b += c.B; n++; }
            }
            var gold = Color.FromArgb((int)(r / n), (int)(g / n), (int)(b / n));
            // The paper colour (light grey, not pure white): average of the four corners.
            int bgB = 0;
            foreach (var pt in new[] { new Point(1, 1), new Point(w - 2, 1), new Point(1, h - 2), new Point(w - 2, h - 2) }) bgB += src.GetPixel(pt.X, pt.Y).B;
            bgB /= 4;
            // White -> transparent: how far each pixel is from white, measured on the
            // channel where gold and white differ most (blue), gives its opacity.
            var clean = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            int x0 = w, y0 = h, x1 = -1, y1 = -1;
            for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
            {
                var c = src.GetPixel(x, y);
                double a = (bgB - c.B) / (double)(bgB - gold.B);
                a = Math.Max(0, Math.Min(1, a)) * (c.A / 255.0);
                int ai = (int)Math.Round(a * 255);
                if (ai < 10) ai = 0;   // paper noise
                clean.SetPixel(x, y, Color.FromArgb(ai, gold));
                if (ai > 20) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
            }
            // Crop to the logo and centre it on a square with a small margin.
            int cw = x1 - x0 + 1, ch = y1 - y0 + 1, side = (int)(Math.Max(cw, ch) * 1.06);
            cleanLogo = new Bitmap(side, side, PixelFormat.Format32bppArgb);
            using (var gg = Graphics.FromImage(cleanLogo))
            {
                gg.Clear(Color.Transparent);
                gg.DrawImage(clean, new Rectangle((side - cw) / 2, (side - ch) / 2, cw, ch), new Rectangle(x0, y0, cw, ch), GraphicsUnit.Pixel);
            }
            clean.Dispose();
            return cleanLogo;
        }
    }

    public static void SaveLogo(string path) { CleanLogo().Save(path, ImageFormat.Png); }

    public static Bitmap QuasarMark(int s)
    {
        var logo = CleanLogo();
        var bmp = new Bitmap(s, s, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            using (var ia = new ImageAttributes())
            {
                ia.SetWrapMode(WrapMode.TileFlipXY);   // no grey fringe at the edges
                g.DrawImage(logo, new Rectangle(0, 0, s, s), 0, 0, logo.Width, logo.Height, GraphicsUnit.Pixel, ia);
            }
        }
        // Small sizes: the thin strokes fade when shrunk, so firm them up a little.
        if (s <= 32)
        {
            float boost = s <= 20 ? 1.6f : 1.3f;
            for (int y = 0; y < s; y++) for (int x = 0; x < s; x++)
            {
                var c = bmp.GetPixel(x, y);
                if (c.A == 0) continue;
                bmp.SetPixel(x, y, Color.FromArgb(Math.Min(255, (int)(c.A * boost)), c.R, c.G, c.B));
            }
        }
        return bmp;
    }

    // Writes a multi-size .ico (PNG-compressed entries, supported since Vista).
    public static void Icon(string icoPath, string previewPng, int[] sizes) { Icon(icoPath, previewPng, sizes, false); }
    public static void Icon(string icoPath, string previewPng, int[] sizes, bool quasar)
    {
        var pngs = new byte[sizes.Length][];
        for (int i = 0; i < sizes.Length; i++)
        {
            using (var bmp = quasar ? QuasarMark(sizes[i]) : Mark(sizes[i]))
            using (var ms = new MemoryStream())
            {
                bmp.Save(ms, ImageFormat.Png);
                pngs[i] = ms.ToArray();
                if (sizes[i] == 256) bmp.Save(previewPng, ImageFormat.Png);
            }
        }
        using (var fs = new FileStream(icoPath, FileMode.Create))
        using (var w = new BinaryWriter(fs))
        {
            w.Write((short)0); w.Write((short)1); w.Write((short)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++)
            {
                w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                w.Write((byte)0); w.Write((byte)0);
                w.Write((short)1); w.Write((short)32);
                w.Write(pngs[i].Length); w.Write(offset);
                offset += pngs[i].Length;
            }
            foreach (var p in pngs) w.Write(p);
        }
    }
}
'@

function Rgb([string]$hex) {
    $hex = $hex.TrimStart('#')
    ,@([Convert]::ToInt32($hex.Substring(0,2),16), [Convert]::ToInt32($hex.Substring(2,2),16), [Convert]::ToInt32($hex.Substring(4,2),16))
}

# ---------------------------------------------------------------------------
# Theme definitions. Each one is a separate Chrome theme, so you can load a
# different one into each Chrome profile (Arc gives each Profile/Space its own
# colour; Chrome can only do one theme per profile).
# ---------------------------------------------------------------------------
$Themes = @(
    @{
        Folder      = 'arc-dawn'
        Name        = 'Arc Dawn'
        Description = 'Arc-style light theme: lavender-to-peach gradient with grain.'
        Gradient    = @('#B9A6F2', '#D9B8EC', '#F6C4B4')   # left -> right
        Glow        = '#FFE3D3'
        Grain       = 7
        Colors      = @{
            frame                   = '#CDB3EE'
            frame_inactive          = '#D9CAEE'
            toolbar                 = '#D2BCEE'   # toolbar uses the frame gradient image; this is the fallback
            toolbar_text            = '#2A2340'
            toolbar_button_icon     = '#4B3F6B'
            tab_text                = '#2A2340'
            tab_background_text     = '#3A2F57'
            tab_background_text_inactive = '#5C5277'
            omnibox_background      = '#F1EAF9'
            omnibox_text            = '#2A2340'
            bookmark_text           = '#3A2F57'
            ntp_background          = '#D9B8EC'
            ntp_text                = '#2A2340'
            ntp_link                = '#5B3FB8'
            ntp_header              = '#CDB3EE'
        }
    },
    @{
        Folder      = 'arc-dusk'
        Name        = 'Arc Dusk'
        Description = 'Arc-style dark theme: indigo-to-plum gradient with grain.'
        Gradient    = @('#1E1B4B', '#3B1F5C', '#5A2346')
        Glow        = '#7A3B6E'
        Grain       = 8
        Colors      = @{
            frame                   = '#33205A'
            frame_inactive          = '#272040'
            toolbar                 = '#33205A'
            toolbar_text            = '#EDE8F7'
            toolbar_button_icon     = '#CFC6EA'
            tab_text                = '#F3EFFB'
            tab_background_text     = '#D8D0EE'
            tab_background_text_inactive = '#A79DC4'
            omnibox_background      = '#2A1F48'
            omnibox_text            = '#EDE8F7'
            bookmark_text           = '#D8D0EE'
            ntp_background          = '#3B1F5C'
            ntp_text                = '#EDE8F7'
            ntp_link                = '#C7B5FF'
            ntp_header              = '#33205A'
        }
    },
    @{
        # Colours sampled from a real Arc window (dark navy Space).
        Folder      = 'arc-night'
        Name        = 'Arc Night'
        Description = 'Arc-style dark theme matched to Arc''s navy Space: seamless frame and toolbar.'
        Gradient    = @('#181A30', '#1C1C37', '#2A2140')
        Glow        = '#2D2D54'
        Grain       = 5
        Colors      = @{
            frame                   = '#1B1C35'
            frame_inactive          = '#18192C'
            toolbar                 = '#1C1C37'
            toolbar_text            = '#E4E2F5'
            toolbar_button_icon     = '#8F8DB3'
            tab_text                = '#E9E7F7'
            tab_background_text     = '#A9A7C8'
            tab_background_text_inactive = '#7F7DA0'
            omnibox_background      = '#262645'
            omnibox_text            = '#E4E2F5'
            bookmark_text           = '#A9A7C8'
            ntp_background          = '#2D2D54'
            ntp_text                = '#E4E2F5'
            ntp_link                = '#B9B7FF'
            ntp_header              = '#1C1C37'
        }
    }
)

foreach ($t in $Themes) {
    $dir = Join-Path $Root "themes\$($t.Folder)"
    $img = Join-Path $dir 'images'
    New-Item -ItemType Directory -Force $img | Out-Null

    $stops = [int[][]]@($t.Gradient | ForEach-Object { ,[int[]](Rgb $_) })
    $glow  = [int[]](Rgb $t.Glow)

    # Window frame, tab strip and toolbar share one image (gradient runs left -> right,
    # no glow, so it is identical at every height). That makes the top of the window
    # one seamless surface like Arc, instead of a separate toolbar band.
    [ArcArt]::Gradient((Join-Path $img 'frame.png'), 3840, 160, $stops, 0, $glow, 0, $t.Grain, 1)
    # New tab page: diagonal gradient with a soft glow, like an Arc Space.
    [ArcArt]::Gradient((Join-Path $img 'ntp.png'), 2560, 1600, $stops, 35, $glow, 0.45, $t.Grain, 2)

    $colors = [ordered]@{}
    foreach ($k in ($t.Colors.Keys | Sort-Object)) { $colors[$k] = Rgb $t.Colors[$k] }

    $manifest = [ordered]@{
        manifest_version = 3
        name             = $t.Name
        version          = '1.0.0'
        description      = $t.Description
        theme            = [ordered]@{
            images = [ordered]@{
                theme_frame                   = 'images/frame.png'
                theme_frame_inactive          = 'images/frame.png'
                theme_toolbar                 = 'images/frame.png'
                theme_tab_background          = 'images/frame.png'
                theme_tab_background_inactive = 'images/frame.png'
                theme_ntp_background          = 'images/ntp.png'
            }
            colors = $colors
            tints = [ordered]@{
                # Slightly washes out the frame when the window is not focused.
                frame_inactive = @(-1, 0.85, 0.6)
            }
            properties = [ordered]@{
                ntp_background_alignment = 'center'
                ntp_background_repeat    = 'no-repeat'
            }
        }
    }
    # Write without a BOM; Chrome rejects manifest.json files that start with one.
    $json = $manifest | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $dir 'manifest.json'), $json, (New-Object Text.UTF8Encoding $false))
    Write-Host "Built theme: $($t.Name) -> $dir"
}

# Taskbar icon
$iconDir = Join-Path $Root 'icon'
New-Item -ItemType Directory -Force $iconDir | Out-Null
[ArcArt]::Icon((Join-Path $iconDir 'arc-chrome.ico'), (Join-Path $iconDir 'arc-chrome-256.png'), [int[]]@(16, 20, 24, 32, 40, 48, 64, 256))
# The Quasar browser's icon (browser\ uses this one; the Chrome extension keeps the arch),
# made from the logo image: white background removed, gold kept as-is.
[ArcArt]::LogoPath = Join-Path $iconDir 'quasar-logo-original.png'
[ArcArt]::Icon((Join-Path $iconDir 'quasar.ico'), (Join-Path $iconDir 'quasar-256.png'), [int[]]@(16, 20, 24, 32, 40, 48, 64, 256), $true)
[ArcArt]::SaveLogo((Join-Path $iconDir 'quasar-logo.png'))   # full-size transparent logo
Write-Host "Built icon: $iconDir\quasar.ico"
Write-Host "Built icon: $iconDir\arc-chrome.ico"

# Extension toolbar/store icons
$extIcons = Join-Path $Root 'extension\icons'
New-Item -ItemType Directory -Force $extIcons | Out-Null
foreach ($s in 16, 32, 48, 128) {
    $bmp = [ArcArt]::Mark($s)
    $bmp.Save((Join-Path $extIcons "icon$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Write-Host "Built extension icons: $extIcons"
