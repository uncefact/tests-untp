import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, 'uploads')));
app.use(express.json());

// Upload JSON data to a file in the uploads directory
app.post('/upload', (req, res) => {
  const inputPath: string = req.body.path;
  const data = req.body.data;
  if (!path || !data) {
    return res.status(400).json({ message: 'Both filePath and jsonData are required' });
  }
  const filePath = path.join(__dirname, 'uploads', inputPath);
  const host = req.get('host');

  try {
    const directory = path.dirname(filePath);
    // Create directories if they don't exist
    fs.mkdirSync(directory, { recursive: true });

    // Write JSON data to file
    fs.writeFileSync(filePath, JSON.stringify(data));
    res.status(200).json({
      url: `http://${host}/${req.body.path}`,
    });
  } catch (error: any) {
    res.status(500).json({ message: `Error storing data: ${error.message as string}` });
  }
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
