const express = require('express');
const app = express();
const port = 3000;
const host = '127.0.0.1';
const bodyParser = require('body-parser');
const path = require('path');
const MongoClient = require('mongodb').MongoClient;
const url = 'mongodb://localhost:27017';
const client = new MongoClient(url);
const dbName = 'movies';
const collectionName = 'movies';
const moviesData = require('./public/javascripts/mongodb');
const multer = require('multer');
const fs = require('fs');

app.use(express.static('public'));
app.use(express.static('public/pages'));
app.use(express.static('public/images'));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());



const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/images/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

app.get('/', (req, res) => res.sendFile(__dirname + "/public/pages/home.html"))
app.post('/create', upload.array('image'), async (req, res) => {
    const movies = JSON.parse(req.body.movies);
    const files = req.files;
    if (!movies || movies.length === 0) {
        res.status(400).json({ message: 'Không có phim nào được cung cấp để tạo' });
        return;
    }
    if (req.files.length !== movies.length) {
        res.status(400).json({ message: 'Số lượng tệp ảnh không phù hợp với số lượng phim' });
        return;
    }    
    try {
        await client.connect();
        const moviesCollection = client.db(dbName).collection(collectionName);
        let nextIdNumber = await moviesData.getNextIdNumber(client, dbName, collectionName);
        movies.forEach((movie, index) => {
            movie.id = 'MOV' + String(nextIdNumber).padStart(4, '0');
            if (files[index]) {
                movie.imagePath = path.basename(files[index].path);
            }
            nextIdNumber++;
        });
        const result = await moviesCollection.insertMany(movies);
        const message = `${movies.length} phim đã được tạo thành công!`;
        res.json({ message: message });
    } catch (err) {
        console.error('Lỗi:', err);
        res.status(500).json({ message: 'Đã xảy ra lỗi' });
    } finally {
        if (client) {
            await client.close();
        }
    }
});

app.get('/read', async (req, res) => {
    const title = req.query.title;
    const id = req.query.id;
    const ratingFr = parseFloat(req.query.ratingFr);
    const ratingTo = parseFloat(req.query.ratingTo);
    
    let query = {};
    let $and = [];
        
    try {
        await client.connect();
        const moviesCollection = client.db(dbName).collection(collectionName);

        if (title && id) {
            $and.push({
                $or: [
                    { title: { $regex: title, $options: 'i' } },
                    { id: { $regex: id, $options: 'i' } }
                ]
            });
        }

        if (ratingTo >= 0) {
            if (ratingTo > ratingFr) {
                $and.push({ rating: { $gte: ratingFr, $lte: ratingTo}})
            } else if (ratingTo == ratingFr && ratingTo != 0) {
                $and.push({ rating: ratingFr})
            }
        }

        if ($and.length > 0) {
            query = { $and };
        }

        const result = await moviesCollection.find(query).toArray();
        
        if (result.length > 0) {
            res.json(result);
        } else {
            res.status(404).json({ message: 'Không tìm thấy kết quả' });
        }
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: 'Đã xảy ra lỗi trong quá trình xử lý yêu cầu' });
    } finally {
        if (client) {
            await client.close();
        }
    }
});


app.get('/read/for/update', async (req, res) => {
    const idQuery = req.query.id;
    try {
        await client.connect();
        moviesCollection = await client.db(dbName).collection(collectionName);
        
        const editMovies = await moviesCollection.find({ id: { $regex: `.*${idQuery}.*`, $options: 'i' } }).toArray();

        if (editMovies.length > 0) {
            res.json(editMovies);
        } else {
            res.status(404).json({ error: 'Không tìm thấy phim' });
        }
    } catch (err) {
        console.error('Error: ', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (client) {
            await client.close();
        }
    }
    
});



app.put('/update', async (req, res) => {
    try {
        await client.connect();

        const newMovie = req.body;
        const id = newMovie.id;

        moviesCollection = await client.db(dbName).collection(collectionName);

        const existingMovie = await moviesCollection.findOne({ id: id });

        if (!existingMovie) {
            res.status(404).json({ message: `Phim với id ${id} không tìm thấy.` });
            return;
        }

        // Kiểm tra xem có thay đổi nào trong dữ liệu mới không
        const updatedFields = {};
        if (existingMovie.title !== newMovie.title) {
            updatedFields.title = newMovie.title;
        }
        if (existingMovie.genre !== newMovie.genre) {
            updatedFields.genre = newMovie.genre;
        }
        if (existingMovie.releaseYear !== newMovie.releaseYear) {
            updatedFields.releaseYear = newMovie.releaseYear;
        }
        if (existingMovie.durationMinutes !== newMovie.durationMinutes) {
            updatedFields.durationMinutes = newMovie.durationMinutes;
        }
        if (existingMovie.rating !== newMovie.rating) {
            updatedFields.rating = newMovie.rating;
        }

        if (Object.keys(updatedFields).length === 0) {
            res.json({ message: `Không phát hiện thấy thay đổi nào đối với phim có id ${id}.` });
            return;
        }

        await moviesCollection.updateOne({ id: id }, { $set: updatedFields });

        const content = `Phim với id = ${id} được cập nhật thành công!`;
        res.json({ message: content });
    } catch (err) {
        console.error('Error: ', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (client) {
            await client.close();
        }
    }
});

app.get('/read/for/delete', async (req, res) => {
    const idQuery = req.query.id;
    try {
        await client.connect();
        moviesCollection = await client.db(dbName).collection(collectionName);
        
        const deleteMovies = await moviesCollection.find({ id: { $regex: `.*${idQuery}.*`, $options: 'i' } }).toArray();

        if (deleteMovies.length > 0) {
            res.json(deleteMovies);
        } else {
            res.status(404).json({ error: 'Không tìm thấy phim' });
        }
    } catch (err) {
        console.error('Error: ', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (client) {
            await client.close();
        }
    }    
});

app.delete('/delete', async (req, res) => {
    try {
        await client.connect()
        const movieId = req.query.id;
        moviesCollection = await client.db(dbName).collection(collectionName);
        const result = await moviesCollection.deleteOne({ id: movieId });

        if (result.deletedCount === 1) {
            res.status(200).json({ message: 'Phim đã được xóa thành công' });
        } else {
            res.status(404).json({ message: 'Không tìm thấy phim cần xóa' });
        }
    } catch (error) {
        console.error('Lỗi khi xóa phim:', error);
        res.status(500).json({ error: 'Lỗi khi xóa phim' });
    } finally {
        await client.close();
    }
});

app.delete('/delete/all', async (req, res) => {
    try {
        await client.connect();
        moviesCollection = await client.db(dbName).collection(collectionName);
        
        const result = await moviesCollection.deleteMany({});

        if (result.deletedCount > 0) {
            res.status(200).json({ message: 'Tất cả các phim đã được xóa thành công' });
        } else {
            res.status(404).json({ message: 'Không tìm thấy phim cần xóa' });
        }
    } catch (err) {
        console.error('Lỗi khi xóa tất cả các phim:', err);
        res.status(500).json({ error: 'Lỗi khi xóa tất cả các phim' });
    } finally {
        await client.close();
    }
});

app.listen(port, host, () => console.log(`Example app listening on port ${host}:${port}!`))