<?php
// Attend (60 s max) que les tests aient envoyé leurs résultats.
for ($i = 0; $i < 600 && !is_file(__DIR__ . '/resultats.json'); $i++) {
    usleep(100000);
    clearstatcache();
}
header('Content-Type: image/gif');
echo base64_decode('R0lGODlhAQABAAAAACw=');
