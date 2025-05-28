const express = require('express'); // Sửa dòng này
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const port = process.env.PORT || 8989;
const excelFilePath = path.join(__dirname, 'data', 'FILE MẪU PHÁT THUỐC HA HẰNG NGÀY.xlsx');

app.use(express.json());
app.use(express.static(__dirname));

// Hàm chuẩn hóa định dạng ngày
function normalizeDate(dateStr) {
    if (!dateStr || dateStr === '/05/2025') {
        console.warn(`Ngày không hợp lệ: ${dateStr}, trả về chuỗi rỗng`);
        return '';
    }
    if (typeof dateStr === 'number') {
        const baseDate = new Date(1899, 11, 30);
        const date = new Date(baseDate.getTime() + dateStr * 24 * 60 * 60 * 1000);
        if (isNaN(date.getTime())) {
            console.warn(`Ngày Excel không hợp lệ: ${dateStr}`);
            return '';
        }
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }
    if (typeof dateStr === 'string') {
        const regex = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
        const match = dateStr.match(regex);
        if (match) {
            const day = parseInt(match[1], 10);
            const month = parseInt(match[2], 10);
            const year = parseInt(match[3], 10);
            const date = new Date(year, month - 1, day);
            if (
                date.getDate() === day &&
                date.getMonth() === month - 1 &&
                date.getFullYear() === year &&
                day >= 1 && day <= 31 &&
                month >= 1 && month <= 12 &&
                year >= 1900 && year <= 2025
            ) {
                return `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
            }
            console.warn(`Ngày không hợp lệ: ${dateStr}`);
            return '';
        }
        console.warn(`Định dạng ngày không đúng: ${dateStr}`);
        return '';
    }
    console.warn(`Kiểu dữ liệu ngày không hỗ trợ: ${dateStr}`);
    return '';
}

// Hàm tính trạng thái tái khám
function getReExamStatus(reExamDate, warningDays = 7) {
    if (!reExamDate || !/^\d{2}\/\d{2}\/\d{4}$/.test(reExamDate)) {
        return { status: 'none', label: 'Không có ngày' };
    }
    const [day, month, year] = reExamDate.split('/').map(Number);
    const reExam = new Date(year, month - 1, day);
    if (isNaN(reExam.getTime())) {
        return { status: 'none', label: 'Ngày không hợp lệ' };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((reExam - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        return { status: 'overdue', label: 'Quá hạn' };
    } else if (diffDays === 0) {
        return { status: 'due', label: 'Hôm nay' };
    } else if (diffDays <= warningDays) {
        return { status: 'upcoming', label: `Sắp đến (${diffDays} ngày)` };
    } else {
        return { status: 'due', label: 'Bình thường' };
    }
}

// Hàm chuẩn hóa dữ liệu bệnh nhân
function normalizePatient(row, index) {
    const examDate = normalizeDate(row['NGÀY KHÁM']);
    const reExamDate = normalizeDate(row['NGÀY TÁI KHÁM']);
    return {
        id: row['STT'] || index + 1,
        name: row['HỌ VÀ TÊN'] || row['HỌ VÀ TÊN BN'] || 'Không xác định',
        year: row['NĂM SINH'] || 0,
        gender: row['Nam'] ? 'Nam' : row['Nữ'] ? 'Nữ' : '',
        house: row['NHÀ'] ? String(row['NHÀ']) : '',
        medication: row['THUỐC'] || row['TÊN THUỐC'] || '',
        examDate: examDate,
        reExamDate: reExamDate,
        area: row['KHU'] ? `Khu ${row['KHU'].trim()}` : 'Không xác định',
        invalidDate: (!examDate && row['NGÀY KHÁM'] && row['NGÀY KHÁM'] !== '/05/2025') || 
                     (!reExamDate && row['NGÀY TÁI KHÁM'] && row['NGÀY TÁI KHÁM'] !== '/05/2025') ? true : false
    };
}

// Hàm tạo file Excel mặc định
function createDefaultExcel() {
    const ws = XLSX.utils.json_to_sheet([]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.utils.sheet_add_aoa(ws, [['STT', 'HỌ VÀ TÊN', 'NĂM SINH', 'Nam', 'Nữ', 'NHÀ', 'THUỐC', 'NGÀY KHÁM', 'NGÀY TÁI KHÁM', 'KHU']], { origin: 'A1' });
    XLSX.writeFile(wb, excelFilePath);
}

// Kiểm tra cấu trúc cột Excel
function validateExcelColumns(sheet) {
    const expectedColumns = ['STT', 'HỌ VÀ TÊN', 'NĂM SINH', 'Nam', 'Nữ', 'NHÀ', 'THUỐC', 'NGÀY KHÁM', 'NGÀY TÁI KHÁM', 'KHU'];
    const firstRow = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
    return expectedColumns.every(col => firstRow.includes(col));
}

// Tải danh sách bệnh nhân
app.get('/patients', (req, res) => {
    try {
        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        if (!sheet) throw new Error('Sheet1 không tồn tại');
        if (!validateExcelColumns(sheet)) {
            throw new Error('Cấu trúc cột trong file Excel không đúng');
        }
        const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        console.log('Dữ liệu gốc từ Excel:', JSON.stringify(data, null, 2));
        const patients = data.map((row, index) => normalizePatient(row, index));
        console.log('Dữ liệu chuẩn hóa:', JSON.stringify(patients, null, 2));
        res.json(patients);
    } catch (error) {
        console.error('Lỗi tải dữ liệu:', error.message);
        res.status(500).json({ error: 'Lỗi tải dữ liệu: ' + error.message });
    }
});

// Thêm bệnh nhân
app.post('/patients', (req, res) => {
    try {
        const newPatient = req.body;
        console.log('Dữ liệu nhận được (POST):', JSON.stringify(newPatient, null, 2));

        if (!newPatient.id || !newPatient.name || !newPatient.year || !newPatient.gender || !newPatient.area) {
            throw new Error('Thiếu thông tin bắt buộc: STT, Họ và Tên, Năm sinh, Giới tính, Phân khu');
        }
        if (isNaN(newPatient.id) || newPatient.id <= 0) {
            throw new Error('STT phải là số dương');
        }
        if (isNaN(newPatient.year) || newPatient.year < 1900 || newPatient.year > 2025) {
            throw new Error('Năm sinh không hợp lệ');
        }
        if (!['I', 'II'].includes(newPatient.area)) {
            throw new Error('Phân khu phải là I hoặc II');
        }
        const examDate = normalizeDate(newPatient.examDate);
        const reExamDate = normalizeDate(newPatient.reExamDate);
        if (newPatient.examDate && !examDate) {
            throw new Error('Ngày khám không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy và là ngày có thật.');
        }
        if (newPatient.reExamDate && !reExamDate) {
            throw new Error('Ngày tái khám không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy và là ngày có thật.');
        }

        if (!fs.existsSync(excelFilePath)) {
            console.warn('File Excel không tồn tại, tạo file mặc định...');
            createDefaultExcel();
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        if (!sheet) throw new Error('Sheet1 không tồn tại');
        let data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const existingIndex = data.findIndex(row => row['STT'] === newPatient.id);
        if (existingIndex !== -1) {
            throw new Error(`STT ${newPatient.id} đã tồn tại`);
        }

        const excelRow = {
            'STT': newPatient.id,
            'HỌ VÀ TÊN': newPatient.name,
            'NĂM SINH': newPatient.year,
            'Nam': newPatient.gender === 'Nam' ? 'Nam' : '',
            'Nữ': newPatient.gender === 'Nữ' ? 'Nữ' : '',
            'NHÀ': newPatient.house || '',
            'THUỐC': newPatient.medication || '',
            'NGÀY KHÁM': examDate,
            'NGÀY TÁI KHÁM': reExamDate,
            'KHU': newPatient.area
        };

        data.push(excelRow);
        data.sort((a, b) => a['STT'] - b['STT']);
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Sheet1'] = newSheet;
        XLSX.writeFile(workbook, excelFilePath);

        res.status(200).json({ message: 'Lưu dữ liệu thành công' });
    } catch (error) {
        console.error('Lỗi lưu dữ liệu:', error.message);
        res.status(400).json({ error: 'Lỗi lưu dữ liệu: ' + error.message });
    }
});

// Cập nhật bệnh nhân
app.put('/patients', (req, res) => {
    try {
        const updatedPatient = req.body;
        console.log('Dữ liệu nhận được (PUT):', JSON.stringify(updatedPatient, null, 2));

        if (!updatedPatient.id || !updatedPatient.name || !updatedPatient.year || !updatedPatient.gender || !updatedPatient.area || !updatedPatient.originalId) {
            throw new Error('Thiếu thông tin bắt buộc: STT, Họ và Tên, Năm sinh, Giới tính, Phân khu, hoặc STT gốc');
        }
        if (isNaN(updatedPatient.id) || updatedPatient.id <= 0) {
            throw new Error('STT phải là số dương');
        }
        if (isNaN(updatedPatient.year) || updatedPatient.year < 1900 || updatedPatient.year > 2025) {
            throw new Error('Năm sinh không hợp lệ');
        }
        if (!['I', 'II'].includes(updatedPatient.area)) {
            throw new Error('Phân khu phải là I hoặc II');
        }
        const examDate = normalizeDate(updatedPatient.examDate);
        const reExamDate = normalizeDate(updatedPatient.reExamDate);
        if (updatedPatient.examDate && !examDate) {
            throw new Error('Ngày khám không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy và là ngày có thật.');
        }
        if (updatedPatient.reExamDate && !reExamDate) {
            throw new Error('Ngày tái khám không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy và là ngày có thật.');
        }

        if (!fs.existsSync(excelFilePath)) {
            throw new Error('File Excel không tồn tại');
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        if (!sheet) throw new Error('Sheet1 không tồn tại');
        let data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (updatedPatient.id !== updatedPatient.originalId) {
            const existingIndex = data.findIndex(row => row['STT'] === updatedPatient.id);
            if (existingIndex !== -1) {
                throw new Error(`STT ${updatedPatient.id} đã tồn tại`);
            }
        }

        const index = data.findIndex(row => row['STT'] === updatedPatient.originalId);
        if (index === -1) {
            throw new Error(`Không tìm thấy bệnh nhân với STT ${updatedPatient.originalId}`);
        }

        data[index] = {
            'STT': updatedPatient.id,
            'HỌ VÀ TÊN': updatedPatient.name,
            'NĂM SINH': updatedPatient.year,
            'Nam': updatedPatient.gender === 'Nam' ? 'Nam' : '',
            'Nữ': updatedPatient.gender === 'Nữ' ? 'Nữ' : '',
            'NHÀ': updatedPatient.house || '',
            'THUỐC': updatedPatient.medication || '',
            'NGÀY KHÁM': examDate,
            'NGÀY TÁI KHÁM': reExamDate,
            'KHU': updatedPatient.area
        };

        data.sort((a, b) => a['STT'] - b['STT']);
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Sheet1'] = newSheet;
        XLSX.writeFile(workbook, excelFilePath);

        console.log(`Cập nhật bệnh nhân STT ${updatedPatient.id} thành công`);
        res.status(200).json({ message: 'Cập nhật dữ liệu thành công' });
    } catch (error) {
        console.error('Lỗi cập nhật dữ liệu:', error.message);
        res.status(400).json({ error: 'Lỗi cập nhật dữ liệu: ' + error.message });
    }
});

// Xóa bệnh nhân
app.delete('/patients/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        console.log(`Yêu cầu xóa bệnh nhân STT ${id}`);
        if (isNaN(id) || id <= 0) {
            throw new Error('STT không hợp lệ');
        }
        if (!fs.existsSync(excelFilePath)) {
            throw new Error('File Excel không tồn tại');
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        if (!sheet) throw new Error('Sheet1 không tồn tại');
        let data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const index = data.findIndex(row => row['STT'] === id);
        if (index === -1) {
            throw new Error(`Không tìm thấy bệnh nhân với STT ${id}`);
        }
        data.splice(index, 1);
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Sheet1'] = newSheet;
        XLSX.writeFile(workbook, excelFilePath);
        console.log(`Xóa bệnh nhân STT ${id} thành công`);
        res.status(200).json({ message: 'Xóa dữ liệu thành công' });
    } catch (error) {
        console.error('Lỗi xóa dữ liệu:', error.message);
        res.status(400).json({ error: 'Lỗi xóa dữ liệu: ' + error.message });
    }
});

// Tạo báo cáo
app.get('/report/:date', (req, res) => {
    try {
        const reportDate = decodeURIComponent(req.params.date);
        const reportType = req.query.type || 'day';
        const area = req.query.area || 'all';
        const endDate = req.query.endDate ? decodeURIComponent(req.query.endDate) : null;
        const warningDays = 7; // Giá trị mặc định
        console.log(`Yêu cầu báo cáo: ngày=${reportDate}, kiểu=${reportType}, khu=${area}, ngày kết thúc=${endDate}`);
        if (!fs.existsSync(excelFilePath)) {
            throw new Error('File Excel không tồn tại');
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        if (!sheet) throw new Error('Sheet1 không tồn tại');
        let data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        let patients = data.map((row, index) => normalizePatient(row, index));
        patients = patients.filter(p => p.reExamDate);
        if (area !== 'all') {
            patients = patients.filter(p => p.area === `Khu ${area}`);
        }
        let filteredPatients = [];
        const [startDay, startMonth, startYear] = reportDate.split('/').map(Number);
        const startDate = new Date(startYear, startMonth - 1, startDay);
        if (isNaN(startDate.getTime())) {
            throw new Error('Ngày báo cáo không hợp lệ');
        }
        if (reportType === 'day') {
            filteredPatients = patients.filter(p => p.reExamDate === reportDate);
        } else if (reportType === 'week') {
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            filteredPatients = patients.filter(p => {
                const [day, month, year] = p.reExamDate.split('/').map(Number);
                const reExamDate = new Date(year, month - 1, day);
                return reExamDate >= startDate && reExamDate <= endDate;
            });
        } else if (reportType === 'month') {
            filteredPatients = patients.filter(p => {
                const [, month, year] = p.reExamDate.split('/').map(Number);
                return month === startMonth && year === startYear;
            });
        } else if (reportType === 'year') {
            filteredPatients = patients.filter(p => {
                const [, , year] = p.reExamDate.split('/').map(Number);
                return year === startYear;
            });
        } else if (reportType === 'range') {
            if (!endDate) throw new Error('Thiếu ngày kết thúc cho báo cáo khoảng thời gian');
            const [endDay, endMonth, endYear] = endDate.split('/').map(Number);
            const endDateObj = new Date(endYear, endMonth - 1, endDay);
            if (isNaN(endDateObj.getTime())) {
                throw new Error('Ngày kết thúc không hợp lệ');
            }
            filteredPatients = patients.filter(p => {
                const [day, month, year] = p.reExamDate.split('/').map(Number);
                const reExamDate = new Date(year, month - 1, day);
                return reExamDate >= startDate && reExamDate <= endDateObj;
            });
        } else {
            throw new Error('Kiểu báo cáo không hợp lệ');
        }
        // Thêm trạng thái tái khám
        filteredPatients = filteredPatients.map(p => ({
            ...p,
            reExamStatus: getReExamStatus(p.reExamDate, warningDays)
        }));
        console.log('Dữ liệu báo cáo:', JSON.stringify(filteredPatients, null, 2));
        res.json(filteredPatients);
    } catch (error) {
        console.error('Lỗi tạo báo cáo:', error.message);
        res.status(400).json({ error: 'Lỗi báo cáo: ' + error.message });
    }
});

// Xuất báo cáo ra Excel
app.get('/report/:date/export', (req, res) => {
    try {
        const reportDate = decodeURIComponent(req.params.date);
        const reportType = req.query.type || 'day';
        const area = req.query.area || 'all';
        const endDate = req.query.endDate ? decodeURIComponent(req.query.endDate) : null;
        const warningDays = 7;
        console.log(`Xuất báo cáo: ngày=${reportDate}, kiểu=${reportType}, khu=${area}, ngày kết thúc=${endDate}`);
        if (!fs.existsSync(excelFilePath)) {
            throw new Error('File Excel không tồn tại');
        }
        const workbook = XLSX.readFile(excelFilePath);
        const sheet = workbook.Sheets['Sheet1'];
        if (!sheet) throw new Error('Sheet1 không tồn tại');
        let data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        let patients = data.map((row, index) => normalizePatient(row, index));
        patients = patients.filter(p => p.reExamDate);
        if (area !== 'all') {
            patients = patients.filter(p => p.area === `Khu ${area}`);
        }
        let filteredPatients = [];
        const [startDay, startMonth, startYear] = reportDate.split('/').map(Number);
        const startDate = new Date(startYear, startMonth - 1, startDay);
        if (isNaN(startDate.getTime())) {
            throw new Error('Ngày báo cáo không hợp lệ');
        }
        if (reportType === 'day') {
            filteredPatients = patients.filter(p => p.reExamDate === reportDate);
        } else if (reportType === 'week') {
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            filteredPatients = patients.filter(p => {
                const [day, month, year] = p.reExamDate.split('/').map(Number);
                const reExamDate = new Date(year, month - 1, day);
                return reExamDate >= startDate && reExamDate <= endDate;
            });
        } else if (reportType === 'month') {
            filteredPatients = patients.filter(p => {
                const [, month, year] = p.reExamDate.split('/').map(Number);
                return month === startMonth && year === startYear;
            });
        } else if (reportType === 'year') {
            filteredPatients = patients.filter(p => {
                const [, , year] = p.reExamDate.split('/').map(Number);
                return year === startYear;
            });
        } else if (reportType === 'range') {
            if (!endDate) throw new Error('Thiếu ngày kết thúc cho báo cáo khoảng thời gian');
            const [endDay, endMonth, endYear] = endDate.split('/').map(Number);
            const endDateObj = new Date(endYear, endMonth - 1, endDay);
            if (isNaN(endDateObj.getTime())) {
                throw new Error('Ngày kết thúc không hợp lệ');
            }
            filteredPatients = patients.filter(p => {
                const [day, month, year] = p.reExamDate.split('/').map(Number);
                const reExamDate = new Date(year, month - 1, day);
                return reExamDate >= startDate && reExamDate <= endDateObj;
            });
        } else {
            throw new Error('Kiểu báo cáo không hợp lệ');
        }
        // Thêm trạng thái
        filteredPatients = filteredPatients.map(p => ({
            ...p,
            reExamStatus: getReExamStatus(p.reExamDate, warningDays)
        }));
        const reportData = filteredPatients.map(p => ({
            'STT': p.id,
            'HỌ VÀ TÊN': p.name,
            'NĂM SINH': p.year,
            'Nam': p.gender === 'Nam' ? 'Nam' : '',
            'Nữ': p.gender === 'Nữ' ? 'Nữ' : '',
            'NHÀ': p.house,
            'THUỐC': p.medication,
            'NGÀY KHÁM': p.examDate,
            'NGÀY TÁI KHÁM': p.reExamDate,
            'KHU': p.area,
            'TRẠNG THÁI TÁI KHÁM': p.reExamStatus.label
        }));
        const reportSheet = XLSX.utils.json_to_sheet(reportData);
        // Định dạng tiêu đề: căn giữa
        const headers = ['STT', 'HỌ VÀ TÊN', 'NĂM SINH', 'Nam', 'Nữ', 'NHÀ', 'THUỐC', 'NGÀY KHÁM', 'NGÀY TÁI KHÁM', 'KHU', 'TRẠNG THÁI TÁI KHÁM'];
        const range = XLSX.utils.decode_range(reportSheet['!ref']);
        for (let c = 0; c <= range.e.c; c++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
            if (reportSheet[cellAddress]) {
                reportSheet[cellAddress].s = {
                    alignment: { horizontal: 'center', vertical: 'center' },
                    font: { bold: true },
                    border: {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: { style: 'thin' },
                        right: { style: 'thin' }
                    }
                };
            }
            // Thêm viền cho tất cả các ô
            for (let r = 1; r <= range.e.r; r++) {
                const cellAddress = XLSX.utils.encode_cell({ r, c });
                if (reportSheet[cellAddress]) {
                    reportSheet[cellAddress].s = {
                        border: {
                            top: { style: 'thin' },
                            bottom: { style: 'thin' },
                            left: { style: 'thin' },
                            right: { style: 'thin' }
                        }
                    };
                }
            }
        }
        const reportWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(reportWb, reportSheet, 'Report');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportFileName = `BaoCao_${reportType}_${reportDate.replace(/\//g, '-')}${endDate ? '_to_' + endDate.replace(/\//g, '-') : ''}.xlsx`;
        const reportFilePath = path.join(__dirname, 'reports', reportFileName);
        if (!fs.existsSync(path.join(__dirname, 'reports'))) {
            fs.mkdirSync(path.join(__dirname, 'reports'));
        }
        XLSX.writeFile(reportWb, reportFilePath);
        console.log(`Xuất báo cáo thành công: ${reportFilePath}`);
        res.download(reportFilePath);
    } catch (error) {
        console.error('Lỗi xuất báo cáo:', error.message);
        res.status(400).json({ error: 'Lỗi xuất báo cáo: ' + error.message });
    }
});

// Phục vụ file vi.json
app.get('/vi.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'vi.json'));
});

// Khởi động server
app.listen(port, () => {
    console.log(`Server chạy tại http://localhost:${port}`);
});