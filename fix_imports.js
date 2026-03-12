import fs from 'fs';
import path from 'path';

const srcDir = '/home/zhang/working/jobclaw/src';

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (file.endsWith('.ts')) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });

  return arrayOfFiles;
}

const files = getAllFiles(srcDir);

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  const regex = /(from|import|export)\s+(['"])(\.\.?\/[^'"]+)\.js(['"])/g;
  
  content = content.replace(regex, (match, p1, p2, p3, p4) => {
    const importPath = p3;
    const fullPath = path.resolve(path.dirname(file), importPath);
    
    // Check if the path without .js is a directory
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      // It's a directory, so it should be /index.js
      changed = true;
      return `${p1} ${p2}${importPath}/index.js${p4}`;
    }
    
    return match;
  });

  if (changed) {
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
  }
});
