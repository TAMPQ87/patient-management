const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

// Cấu hình multer để lưu file tạm thời
fs.mkdirSync('uploads', { recursive: true });
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            cb(null, true);
        } else {
            cb(new Error('File phải có định dạng .xlsx'), false);
        }
    },
    limits: { fileSize: 10 * 1024 * 1024 } // Giới hạn 10MB
});

// Cấu hình file và bộ nhớ đệm
const excelFilePath = path.join(__dirname, 'data', 'FILE MẪU PHÁT THUỐC HA HẰNG NGÀY.xlsx');
const reportDir = path.join(__dirname, 'reports');

// Tạo thư mục báo cáo nếu chưa tồn tại
if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir);
}

// Bộ nhớ đệm
let cachedData = null;
let lastModified = null;

function getExcelData() {
    const stats = fs.statSync(excelFilePath);
    if (!cachedData || stats.mtimeMs !== lastModified) {
        const workbook = XLSX.readFile(excelFilePath);
        cachedData = XLSX.utils.sheet_to_json(workbook.Sheets['Sheet1'], { defval: '' });
        lastModified = stats.mtimeMs;
        // Kiểm tra dữ liệu không hợp lệ
        const invalidRecords = cachedData.filter(row => {
            const examDate = normalizeDate(row['NGÀY KHÁM']);
            const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
            return (row['NGÀY KHÁM'] && !moment(examDate, 'DD/MM/YYYY', true).isValid()) ||
                   (row['NGÀY TÁI KHÁM'] && !moment(reExamDate, 'DD/MM/YYYY', true).isValid());
        });
        if (invalidRecords.length > 0) {
            console.warn(`Cảnh báo: ${invalidRecords.length} bản ghi có ngày không hợp lệ`);
        }
    }
    return cachedData;
}

// Hàm chuẩn hóa ngày
function normalizeDate(dateStr) {
    if (!dateStr || dateStr === '/05/2025') return '';
    if (typeof dateStr === 'number') {
        const baseDate = new Date(1899, 11, 30);
        const date = new Date(baseDate.getTime() + dateStr * 24 * 60 * 60 * 1000);
        if (isNaN(date.getTime())) return '';
        return moment(date).format('DD/MM/YYYY');
    }
    if (typeof dateStr === 'string') {
        const parsed = moment(dateStr, ['DD/MM/YYYY', 'D/M/YYYY'], true);
        if (parsed.isValid()) {
            return parsed.format('DD/MM/YYYY');
        }
    }
    return '';
}

// Hàm phân tích ngày
function parseDate(dateStr) {
    if (!dateStr) return null;
    const parsed = moment(dateStr, 'DD/MM/YYYY', true);
    if (!parsed.isValid()) return null;
    return parsed.toDate();
}

// Hàm tạo file Excel mặc định
function createDefaultExcel() {
    const defaultData = [
        {
            'STT': 1,
            'HỌ VÀ TÊN': 'Mai Thị Phi Lan',
            'NĂM SINH': 1944,
            'Nam': '',
            'Nữ': 'Nữ',
            'NHÀ': 'Nhà 1',
            'THUỐC': 'Amlodipin 5 mg',
            'NGÀY KHÁM': '',
            'NGÀY TÁI KHÁM': '17/05/2025',
            'KHU': 'I'
        }
    ];
    const ws = XLSX.utils.json_to_sheet(defaultData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, excelFilePath);
    console.log(`Đã tạo file Excel mặc định tại: ${excelFilePath}`);
}

// Hàm chuẩn hóa bệnh nhân
function normalizePatient(row, index) {
    return {
        id: row['STT'] || index + 1,
        name: row['HỌ VÀ TÊN'] || row['HỌ VÀ TÊN BN'] || 'Không xác định',
        year: row['NĂM SINH'] || 0,
        gender: row['Nam'] ? 'Nam' : row['Nữ'] ? 'Nữ' : '',
        house: row['NHÀ'] ? String(row['NHÀ']) : '',
        medication: row['THUỐC'] || row['TÊN THUỐC'] || '',
        examDate: normalizeDate(row['NGÀY KHÁM']),
        reExamDate: normalizeDate(row['NGÀY TÁI KHÁM']),
        area: row['KHU'] ? `Khu ${row['KHU'].trim()}` : 'Không xác định'
    };
}

// Kiểm tra cấu trúc cột
function validateExcelColumns(data) {
    if (data.length === 0) return false;
    const requiredColumns = ['STT', 'HỌ VÀ TÊN', 'NĂM SINH', 'Nam', 'Nữ', 'NHÀ', 'THUỐC', 'NGÀY KHÁM', 'NGÀY TÁI KHÁM', 'KHU'];
    const columns = Object.keys(data[0]);
    return requiredColumns.every(col => columns.includes(col));
}

// Hàm tính trạng thái tái khám
function getReExamStatusForRow(reExamDate, warningDays = 7) {
    if (!reExamDate || !moment(reExamDate, 'DD/MM/YYYY', true).isValid()) {
        return 'none';
    }
    const reExam = moment(reExamDate, 'DD/MM/YYYY').toDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((reExam - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
        return 'overdue';
    } else if (diffDays === 0) {
        return 'due';
    } else if (diffDays <= warningDays) {
        return 'upcoming';
    } else {
        return 'normal';
    }
}

// Lấy danh sách bệnh nhân
app.get('/patients', (req, res) => {
    try {
        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        let data = getExcelData();
        if (data.length === 0 || !validateExcelColumns(data)) {
            console.warn('File Excel rỗng hoặc sai cấu trúc, tạo file mặc định...');
            createDefaultExcel();
            data = getExcelData();
        }
        const patients = data.map((row, index) => normalizePatient(row, index));
        console.log(`Tổng số bệnh nhân: ${patients.length}`);
        res.json(patients);
    } catch (error) {
        console.error('Lỗi tải dữ liệu bệnh nhân:', error.message);
        res.status(500).json({ error: 'Lỗi tải dữ liệu bệnh nhân: ' + error.message });
    }
});

// Lấy danh sách bệnh nhân có ngày không hợp lệ
app.get('/patients/invalid', (req, res) => {
    try {
        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        const data = getExcelData();
        const invalidPatients = data.filter(row => {
            const examDate = normalizeDate(row['NGÀY KHÁM']);
            const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
            return (row['NGÀY KHÁM'] && !moment(examDate, 'DD/MM/YYYY', true).isValid()) ||
                   (row['NGÀY TÁI KHÁM'] && !moment(reExamDate, 'DD/MM/YYYY', true).isValid());
        }).map((row, index) => normalizePatient(row, index));
        console.log(`Tìm thấy ${invalidPatients.length} bệnh nhân có ngày không hợp lệ`);
        res.json(invalidPatients);
    } catch (error) {
        console.error('Lỗi tìm bệnh nhân không hợp lệ:', error.message);
        res.status(500).json({ error: 'Lỗi tìm bệnh nhân không hợp lệ: ' + error.message });
    }
});

// Thêm bệnh nhân mới
app.post('/patients', (req, res) => {
    try {
        const patient = req.body;
        console.log('Thêm bệnh nhân:', patient);

        if (!patient.id || !patient.name || !patient.year || !patient.gender || !patient.area) {
            throw new Error('Thiếu thông tin bắt buộc: STT, Họ và Tên, Năm sinh, Giới tính, Phân khu');
        }
        if (isNaN(patient.id) || patient.id <= 0) {
            throw new Error('STT phải là số dương');
        }
        if (isNaN(patient.year) || patient.year < 1900 || patient.year > 2025) {
            throw new Error('Năm sinh phải từ 1900 đến 2025');
        }
        if (!['I', 'II'].includes(patient.area)) {
            throw new Error('Phân khu phải là I hoặc II');
        }
        if (patient.examDate && !moment(patient.examDate, 'DD/MM/YYYY', true).isValid()) {
            throw new Error('Ngày khám không hợp lệ');
        }
        if (patient.reExamDate && !moment(patient.reExamDate, 'DD/MM/YYYY', true).isValid()) {
            throw new Error('Ngày tái khám không hợp lệ');
        }

        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        let data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (data.some(row => row['STT'] === patient.id)) {
            throw new Error(`Bệnh nhân với STT ${patient.id} đã tồn tại`);
        }

        data.push({
            'STT': patient.id,
            'HỌ VÀ TÊN': patient.name,
            'NĂM SINH': patient.year,
            'Nam': patient.gender === 'Nam' ? 'Nam' : '',
            'Nữ': patient.gender === 'Nữ' ? 'Nữ' : '',
            'NHÀ': patient.house || '',
            'THUỐC': patient.medication || '',
            'NGÀY KHÁM': patient.examDate || '',
            'NGÀY TÁI KHÁM': patient.reExamDate || '',
            'KHU': patient.area
        });

        data.sort((a, b) => a['STT'] - b['STT']);
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Sheet1'] = newSheet;
        XLSX.writeFile(workbook, excelFilePath);
        cachedData = null; // Reset cache

        res.status(201).json({ message: 'Thêm bệnh nhân thành công' });
    } catch (error) {
        console.error('Lỗi thêm bệnh nhân:', error.message);
        res.status(400).json({ error: 'Lỗi thêm bệnh nhân: ' + error.message });
    }
});

// Cập nhật bệnh nhân
app.put('/patients', (req, res) => {
    try {
        const patient = req.body;
        const originalId = patient.originalId;
        console.log('Cập nhật bệnh nhân:', patient);

        if (!patient.id || !patient.name || !patient.year || !patient.gender || !patient.area) {
            throw new Error('Thiếu thông tin bắt buộc: STT, Họ và Tên, Năm sinh, Giới tính, Phân khu');
        }
        if (isNaN(patient.id) || patient.id <= 0) {
            throw new Error('STT phải là số dương');
        }
        if (isNaN(patient.year) || patient.year < 1900 || patient.year > 2025) {
            throw new Error('Năm sinh phải từ 1900 đến 2025');
        }
        if (!['I', 'II'].includes(patient.area)) {
            throw new Error('Phân khu phải là I hoặc II');
        }
        if (patient.examDate && !moment(patient.examDate, 'DD/MM/YYYY', true).isValid()) {
            throw new Error('Ngày khám không hợp lệ');
        }
        if (patient.reExamDate && !moment(patient.reExamDate, 'DD/MM/YYYY', true).isValid()) {
            throw new Error('Ngày tái khám không hợp lệ');
        }

        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        let data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const index = data.findIndex(row => row['STT'] === originalId);
        if (index === -1) {
            throw new Error(`Không tìm thấy bệnh nhân với STT ${originalId}`);
        }
        if (patient.id !== originalId && data.some(row => row['STT'] === patient.id)) {
            throw new Error(`STT ${patient.id} đã tồn tại`);
        }

        data[index] = {
            'STT': patient.id,
            'HỌ VÀ TÊN': patient.name,
            'NĂM SINH': patient.year,
            'Nam': patient.gender === 'Nam' ? 'Nam' : '',
            'Nữ': patient.gender === 'Nữ' ? 'Nữ' : '',
            'NHÀ': patient.house || '',
            'THUỐC': patient.medication || '',
            'NGÀY KHÁM': patient.examDate || '',
            'NGÀY TÁI KHÁM': patient.reExamDate || '',
            'KHU': patient.area
        };

        data.sort((a, b) => a['STT'] - b['STT']);
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Sheet1'] = newSheet;
        XLSX.writeFile(workbook, excelFilePath);
        cachedData = null; // Reset cache

        res.json({ message: 'Cập nhật bệnh nhân thành công' });
    } catch (error) {
        console.error('Lỗi cập nhật bệnh nhân:', error.message);
        res.status(400).json({ error: 'Lỗi cập nhật bệnh nhân: ' + error.message });
    }
});

// Xóa bệnh nhân
app.delete('/patients/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        console.log(`Xóa bệnh nhân STT ${id}`);

        if (isNaN(id) || id <= 0) {
            throw new Error('STT không hợp lệ');
        }

        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        let data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const index = data.findIndex(row => row['STT'] === id);
        if (index === -1) {
            throw new Error(`Không tìm thấy bệnh nhân với STT ${id}`);
        }

        data.splice(index, 1);
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Sheet1'] = newSheet;
        XLSX.writeFile(workbook, excelFilePath);
        cachedData = null; // Reset cache

        res.json({ message: 'Xóa bệnh nhân thành công' });
    } catch (error) {
        console.error('Lỗi xóa bệnh nhân:', error.message);
        res.status(400).json({ error: 'Lỗi xóa bệnh nhân: ' + error.message });
    }
});

// Báo cáo
app.get('/report/:date', (req, res) => {
    try {
        let reportDate = decodeURIComponent(req.params.date);
        const reportType = req.query.type || 'day';
        const area = req.query.area || 'all';
        const statuses = Array.isArray(req.query.status) ? req.query.status : req.query.status ? [req.query.status] : [];
        const warningDays = parseInt(req.query.warningDays) || 7;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        reportDate = normalizeDate(reportDate);
        console.log(`Yêu cầu báo cáo: ngày=${reportDate}, kiểu=${reportType}, khu=${area}, trạng thái=${statuses.join(',')}, warningDays=${warningDays}, page=${page}, limit=${limit}`);

        if (!reportDate || !moment(reportDate, 'DD/MM/YYYY', true).isValid()) {
            throw new Error('Ngày báo cáo không hợp lệ, yêu cầu định dạng dd/mm/yyyy');
        }
        if (reportType === 'range') {
            const endDate = req.query.endDate ? normalizeDate(decodeURIComponent(req.query.endDate)) : '';
            if (!endDate || !moment(endDate, 'DD/MM/YYYY', true).isValid()) {
                throw new Error('Ngày kết thúc không hợp lệ');
            }
            if (moment(endDate, 'DD/MM/YYYY').isBefore(moment(reportDate, 'DD/MM/YYYY'))) {
                throw new Error('Ngày kết thúc phải sau ngày bắt đầu');
            }
        }
        if (statuses.length === 0) {
            throw new Error('Phải chọn ít nhất một trạng thái tái khám');
        }
        if (warningDays < 0 || warningDays > 30) {
            throw new Error('Ngưỡng cảnh báo phải từ 0 đến 30 ngày');
        }
        const validStatuses = ['upcoming', 'due', 'overdue', 'none', 'normal'];
        if (!statuses.every(status => validStatuses.includes(status))) {
            throw new Error('Trạng thái tái khám không hợp lệ');
        }

        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        let data = getExcelData();
        if (data.length === 0 || !validateExcelColumns(data)) {
            console.warn('File Excel rỗng hoặc sai cấu trúc, tạo file mặc định...');
            createDefaultExcel();
            data = getExcelData();
        }

        // Lọc theo khu vực
        if (area !== 'all') {
            data = data.filter(row => row['KHU'] === area.replace('Khu ', ''));
        }

        let report = [];
        const inputDate = parseDate(reportDate);
        if (!inputDate) {
            throw new Error('Ngày báo cáo không hợp lệ');
        }

        if (reportType === 'day') {
            report = data.filter(row => {
                const examDate = normalizeDate(row['NGÀY KHÁM']);
                const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
                const status = getReExamStatusForRow(reExamDate, warningDays);
                return (examDate === reportDate || reExamDate === reportDate) && statuses.includes(status);
            });
        } else if (reportType === 'range') {
            const endDate = normalizeDate(decodeURIComponent(req.query.endDate));
            const start = parseDate(reportDate);
            const end = parseDate(endDate);
            if (!end) {
                throw new Error('Ngày kết thúc không hợp lệ');
            }
            report = data.filter(row => {
                const examDate = normalizeDate(row['NGÀY KHÁM']);
                const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
                const status = getReExamStatusForRow(reExamDate, warningDays);
                const dates = [examDate, reExamDate].filter(d => d);
                return dates.some(dateStr => {
                    const date = parseDate(dateStr);
                    return date && date >= start && date <= end;
                }) && statuses.includes(status);
            });
        } else {
            report = data.filter(row => {
                const examDate = normalizeDate(row['NGÀY KHÁM']);
                const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
                const status = getReExamStatusForRow(reExamDate, warningDays);
                const dates = [examDate, reExamDate].filter(d => d);
                return dates.some(dateStr => {
                    const date = parseDate(dateStr);
                    if (!date) return false;
                    if (reportType === 'year') {
                        return date.getFullYear() === inputDate.getFullYear();
                    } else if (reportType === 'month') {
                        return date.getFullYear() === inputDate.getFullYear() &&
                               date.getMonth() === inputDate.getMonth();
                    } else if (reportType === 'week') {
                        const inputMonday = new Date(inputDate);
                        inputMonday.setDate(inputDate.getDate() - (inputDate.getDay() || 7) + 1);
                        inputMonday.setHours(0, 0, 0, 0);
                        const inputSunday = new Date(inputMonday);
                        inputSunday.setDate(inputMonday.getDate() + 6);
                        inputSunday.setHours(23, 59, 59, 999);
                        return date >= inputMonday && date <= inputSunday;
                    }
                    return false;
                }) && statuses.includes(status);
            });
        }

        // Phân trang
        const total = report.length;
        const start = (page - 1) * limit;
        const end = start + limit;
        report = report.slice(start, end).map((row, index) => normalizePatient(row, start + index));

        console.log(`Báo cáo tìm thấy ${total} bệnh nhân, trả về ${report.length} bản ghi (trang ${page})`);
        res.json({
            data: report,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Lỗi tạo báo cáo:', error.message);
        res.status(400).json({ error: 'Lỗi tạo báo cáo: ' + error.message });
    }
});

// Xuất báo cáo ra Excel
app.get('/report/:date/export', (req, res) => {
    try {
        let reportDate = decodeURIComponent(req.params.date);
        const reportType = req.query.type || 'day';
        const area = req.query.area || 'all';
        const statuses = Array.isArray(req.query.status) ? req.query.status : req.query.status ? [req.query.status] : [];
        const warningDays = parseInt(req.query.warningDays) || 7;
        reportDate = normalizeDate(reportDate);
        console.log(`Yêu cầu xuất báo cáo: ngày=${reportDate}, kiểu=${reportType}, khu=${area}, trạng thái=${statuses.join(',')}, warningDays=${warningDays}`);

        if (!reportDate || !moment(reportDate, 'DD/MM/YYYY', true).isValid()) {
            throw new Error('Ngày báo cáo không hợp lệ, yêu cầu định dạng dd/mm/yyyy');
        }
        if (reportType === 'range') {
            const endDate = req.query.endDate ? normalizeDate(decodeURIComponent(req.query.endDate)) : '';
            if (!endDate || !moment(endDate, 'DD/MM/YYYY', true).isValid()) {
                throw new Error('Ngày kết thúc không hợp lệ');
            }
            if (moment(endDate, 'DD/MM/YYYY').isBefore(moment(reportDate, 'DD/MM/YYYY'))) {
                throw new Error('Ngày kết thúc phải sau ngày bắt đầu');
            }
        }
        if (statuses.length === 0) {
            throw new Error('Phải chọn ít nhất một trạng thái tái khám');
        }
        if (warningDays < 0 || warningDays > 30) {
            throw new Error('Ngưỡng cảnh báo phải từ 0 đến 30 ngày');
        }
        const validStatuses = ['upcoming', 'due', 'overdue', 'none', 'normal'];
        if (!statuses.every(status => validStatuses.includes(status))) {
            throw new Error('Trạng thái tái khám không hợp lệ');
        }

        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        let data = getExcelData();
        if (data.length === 0 || !validateExcelColumns(data)) {
            console.warn('File Excel rỗng hoặc sai cấu trúc, tạo file mặc định...');
            createDefaultExcel();
            data = getExcelData();
        }

        // Lọc theo khu vực
        if (area !== 'all') {
            data = data.filter(row => row['KHU'] === area.replace('Khu ', ''));
        }

        let report = [];
        const inputDate = parseDate(reportDate);
        if (!inputDate) {
            throw new Error('Ngày báo cáo không hợp lệ');
        }

        if (reportType === 'day') {
            report = data.filter(row => {
                const examDate = normalizeDate(row['NGÀY KHÁM']);
                const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
                const status = getReExamStatusForRow(reExamDate, warningDays);
                return (examDate === reportDate || reExamDate === reportDate) && statuses.includes(status);
            });
        } else if (reportType === 'range') {
            const endDate = normalizeDate(decodeURIComponent(req.query.endDate));
            const start = parseDate(reportDate);
            const end = parseDate(endDate);
            if (!end) {
                throw new Error('Ngày kết thúc không hợp lệ');
            }
            report = data.filter(row => {
                const examDate = normalizeDate(row['NGÀY KHÁM']);
                const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
                const status = getReExamStatusForRow(reExamDate, warningDays);
                const dates = [examDate, reExamDate].filter(d => d);
                return dates.some(dateStr => {
                    const date = parseDate(dateStr);
                    return date && date >= start && date <= end;
                }) && statuses.includes(status);
            });
        } else {
            report = data.filter(row => {
                const examDate = normalizeDate(row['NGÀY KHÁM']);
                const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
                const status = getReExamStatusForRow(reExamDate, warningDays);
                const dates = [examDate, reExamDate].filter(d => d);
                return dates.some(dateStr => {
                    const date = parseDate(dateStr);
                    if (!date) return false;
                    if (reportType === 'year') {
                        return date.getFullYear() === inputDate.getFullYear();
                    } else if (reportType === 'month') {
                        return date.getFullYear() === inputDate.getFullYear() &&
                               date.getMonth() === inputDate.getMonth();
                    } else if (reportType === 'week') {
                        const inputMonday = new Date(inputDate);
                        inputMonday.setDate(inputDate.getDate() - (inputDate.getDay() || 7) + 1);
                        inputMonday.setHours(0, 0, 0, 0);
                        const inputSunday = new Date(inputMonday);
                        inputSunday.setDate(inputMonday.getDate() + 6);
                        inputSunday.setHours(23, 59, 59, 999);
                        return date >= inputMonday && date <= inputSunday;
                    }
                    return false;
                }) && statuses.includes(status);
            });
        }

        // Chuẩn bị dữ liệu cho file Excel
        const exportData = report.map(row => ({
            'STT': row['STT'],
            'HỌ VÀ TÊN': row['HỌ VÀ TÊN'],
            'NĂM SINH': row['NĂM SINH'],
            'Giới tính': row['Nam'] ? 'Nam' : row['Nữ'] ? 'Nữ' : '',
            'NHÀ': row['NHÀ'],
            'THUỐC': row['THUỐC'],
            'NGÀY KHÁM': normalizeDate(row['NGÀY KHÁM']),
            'NGÀY TÁI KHÁM': normalizeDate(row['NGÀY TÁI KHÁM']),
            'KHU': row['KHU'],
            'TRẠNG THÁI TÁI KHÁM': getReExamStatusForRow(normalizeDate(row['NGÀY TÁI KHÁM']), warningDays)
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `BaoCao_${reportType}_${reportDate.replace(/\//g, '-')}_${timestamp}.xlsx`;
        const filePath = path.join(reportDir, fileName);
        XLSX.writeFile(wb, filePath);

        // Xóa file báo cáo cũ (>7 ngày)
        const files = fs.readdirSync(reportDir);
        const now = new Date();
        files.forEach(file => {
            const filePath = path.join(reportDir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtime > 7 * 24 * 60 * 60 * 1000) {
                fs.unlinkSync(filePath);
                console.log(`Đã xóa báo cáo cũ: ${file}`);
            }
        });

        res.download(filePath, fileName, (err) => {
            if (err) {
                console.error('Lỗi tải file:', err.message);
                res.status(500).json({ error: 'Lỗi tải file báo cáo' });
            }
        });
    } catch (error) {
        console.error('Lỗi xuất báo cáo:', error.message);
        res.status(400).json({ error: 'Lỗi xuất báo cáo: ' + error.message });
    }
});

// Nhập bệnh nhân từ file Excel
app.post('/patients/import', upload.single('excelFile'), (req, res) => {
    try {
        if (!req.file) {
            throw new Error('Không tìm thấy file Excel');
        }
        const uploadedFilePath = req.file.path;
        const workbook = XLSX.readFile(uploadedFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        if (!sheet) {
            throw new Error('Không tìm thấy Sheet1 trong file Excel');
        }
        const newData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (!validateExcelColumns(newData)) {
            throw new Error('File Excel không đúng cấu trúc cột');
        }

        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel chính không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        const mainWorkbook = XLSX.readFile(excelFilePath);
        const mainSheet = mainWorkbook.Sheets['Sheet1'];
        let mainData = XLSX.utils.sheet_to_json(mainSheet, { defval: '' });

        const errors = [];
        const imported = [];
        const existingIds = new Set(mainData.map(row => row['STT']));

        for (const row of newData) {
            const patient = {
                id: row['STT'],
                name: row['HỌ VÀ TÊN'] || '',
                year: row['NĂM SINH'] || 0,
                gender: row['Nam'] ? 'Nam' : row['Nữ'] ? 'Nữ' : '',
                house: row['NHÀ'] ? String(row['NHÀ']) : '',
                medication: row['THUỐC'] || '',
                examDate: normalizeDate(row['NGÀY KHÁM']),
                reExamDate: normalizeDate(row['NGÀY TÁI KHÁM']),
                area: row['KHU'] || ''
            };

            // Kiểm tra dữ liệu
            if (!patient.id || !patient.name || !patient.year || !patient.gender || !patient.area) {
                errors.push(`STT ${patient.id}: Thiếu thông tin bắt buộc`);
                continue;
            }
            if (isNaN(patient.id) || patient.id <= 0) {
                errors.push(`STT ${patient.id}: STT phải là số dương`);
                continue;
            }
            if (existingIds.has(patient.id)) {
                errors.push(`STT ${patient.id}: Đã tồn tại`);
                continue;
            }
            if (isNaN(patient.year) || patient.year < 1900 || patient.year > 2025) {
                errors.push(`STT ${patient.id}: Năm sinh không hợp lệ`);
                continue;
            }
            if (!['I', 'II'].includes(patient.area)) {
                errors.push(`STT ${patient.id}: Phân khu phải là I hoặc II`);
                continue;
            }
            if (patient.examDate && !moment(patient.examDate, 'DD/MM/YYYY', true).isValid()) {
                errors.push(`STT ${patient.id}: Ngày khám không hợp lệ`);
                continue;
            }
            if (patient.reExamDate && !moment(patient.reExamDate, 'DD/MM/YYYY', true).isValid()) {
                errors.push(`STT ${patient.id}: Ngày tái khám không hợp lệ`);
                continue;
            }

            mainData.push({
                'STT': patient.id,
                'HỌ VÀ TÊN': patient.name,
                'NĂM SINH': patient.year,
                'Nam': patient.gender === 'Nam' ? 'Nam' : '',
                'Nữ': patient.gender === 'Nữ' ? 'Nữ' : '',
                'NHÀ': patient.house,
                'THUỐC': patient.medication,
                'NGÀY KHÁM': patient.examDate,
                'NGÀY TÁI KHÁM': patient.reExamDate,
                'KHU': patient.area
            });
            existingIds.add(patient.id);
            imported.push(patient.id);
        }

        // Lưu vào file chính
        mainData.sort((a, b) => a['STT'] - b['STT']);
        const newSheet = XLSX.utils.json_to_sheet(mainData);
        mainWorkbook.Sheets['Sheet1'] = newSheet;
        XLSX.writeFile(mainWorkbook, excelFilePath);
        cachedData = null; // Reset cache

        // Xóa file tạm
        fs.unlinkSync(uploadedFilePath);

        res.status(200).json({
            message: 'Nhập dữ liệu thành công',
            imported: imported.length,
            errors: errors
        });
    } catch (error) {
        console.error('Lỗi nhập file Excel:', error.message);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path); // Xóa file tạm nếu có lỗi
        }
        res.status(400).json({ error: 'Lỗi nhập file Excel: ' + error.message });
    }
});

// Xử lý yêu cầu favicon.ico
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Khởi động server
app.listen(port, () => {
    console.log(`Server chạy tại http://localhost:${port}`);
});