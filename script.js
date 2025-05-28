$(document).ready(function() {
    let table;
    let isEditMode = false;

    // Khởi tạo date picker với bản địa hóa tiếng Việt
    flatpickr('#examDate, #reExamDate, #reportDate, #endDate', {
        dateFormat: 'd/m/Y',
        allowInput: true,
        placeholder: 'dd/mm/yyyy',
        locale: 'vn',
        altInput: true,
        altFormat: 'd/m/Y'
    });

    // Hàm kiểm tra ngày hợp lệ
    function isValidDate(dateStr) {
        if (!dateStr) return true; // Ngày rỗng là hợp lệ
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
            return false; // Sai định dạng
        }
        const [day, month, year] = dateStr.split('/').map(Number);
        if (year < 1900 || year > 2025 || month < 1 || month > 12 || day < 1 || day > 31) {
            return false; // Ngoài phạm vi
        }
        const date = new Date(year, month - 1, day);
        return date.getDate() === day && date.getMonth() === month - 1 && date.getFullYear() === year;
    }

    // Hàm tính trạng thái tái khám
    function getReExamStatus(reExamDate, warningDays) {
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

    // Khởi tạo DataTable
    function initTable(data) {
        if (table) {
            table.destroy();
            $('#patientTable tbody').empty();
            $('#patientTable thead').empty().append(`
                <tr>
                    <th>STT</th>
                    <th>Họ và Tên</th>
                    <th>Năm sinh</th>
                    <th>Giới tính</th>
                    <th>Nhà</th>
                    <th>Thuốc</th>
                    <th>Ngày khám</th>
                    <th>Ngày tái khám</th>
                    <th>Trạng thái tái khám</th>
                    <th>Khu vực</th>
                    <th>Hành động</th>
                </tr>
            `);
        }
        console.log('Dữ liệu tải vào bảng:', JSON.stringify(data, null, 2));
        if (!data || !Array.isArray(data) || data.length === 0) {
            console.warn('Không có dữ liệu để hiển thị trong bảng');
            data = [];
        }
        const warningDays = parseInt($('#warningDays').val()) || 7;
        // Sử dụng reExamStatus từ server nếu có, nếu không thì tính lại
        data = data.map(row => ({
            ...row,
            reExamStatus: row.reExamStatus || getReExamStatus(row.reExamDate, warningDays)
        }));

        // Cảnh báo ngày không hợp lệ
        const invalidDatePatients = data.filter(row => row.invalidDate);
        if (invalidDatePatients.length > 0) {
            const patientList = invalidDatePatients.map(p => `STT ${p.id}: ${p.name}`).join('\n');
            alert(`Cảnh báo: Có ${invalidDatePatients.length} bệnh nhân có ngày không hợp lệ:\n${patientList}\nVui lòng chỉnh sửa thông tin bệnh nhân!`);
        }

        // Cảnh báo bệnh nhân quá hạn
        const overduePatients = data.filter(row => row.reExamStatus.status === 'overdue');
        if (overduePatients.length > 0) {
            alert(`Cảnh báo: Có ${overduePatients.length} bệnh nhân đã quá hạn tái khám!`);
        }

        table = $('#patientTable').DataTable({
            data: data,
            columns: [
                { data: 'id', defaultContent: '' },
                { data: 'name', defaultContent: 'Không xác định' },
                { data: 'year', defaultContent: '' },
                { data: 'gender', defaultContent: '' },
                { data: 'house', defaultContent: '' },
                { data: 'medication', defaultContent: '' },
                { data: 'examDate', defaultContent: '' },
                { data: 'reExamDate', defaultContent: '' },
                {
                    data: 'reExamStatus',
                    render: function(data, type, row) {
                        if (type === 'display') {
                            return `<span class="status-${data.status}">${data.label}</span>`;
                        }
                        return data.label;
                    }
                },
                { data: 'area', defaultContent: '' },
                {
                    data: null,
                    defaultContent: '',
                    render: function(data, type, row) {
                        if (type === 'display') {
                            return `
                                <div class="action-buttons">
                                    <button class="btn btn-warning btn-sm edit-btn" data-id="${row.id}">Sửa</button>
                                    <button class="btn btn-danger btn-sm delete-btn" data-id="${row.id}">Xóa</button>
                                </div>
                            `;
                        }
                        return '';
                    }
                }
            ],
            pageLength: 10,
            language: { url: '/vi.json' },
            drawCallback: function() {
                console.log('Bảng đã được vẽ lại');
            },
            rowCallback: function(row, data) {
                if (data.reExamStatus.status !== 'none') {
                    $(row).find('td:eq(8)').addClass(`status-${data.reExamStatus.status}`);
                }
                if (data.invalidDate) {
                    $(row).find('td:eq(7)').addClass('status-overdue');
                }
            }
        });

        table.column(9).visible(false);

        $('#areaFilter').off('change').on('change', function() {
            const area = $(this).val();
            console.log(`Lọc khu vực: ${area}`);
            if (area === 'all') {
                table.column(9).search('').draw();
            } else {
                table.column(9).search(`^Khu ${area}$`, true, false).draw();
            }
        });

        $('#statusFilter').off('change').on('change', function() {
            const status = $(this).val();
            console.log(`Lọc trạng thái tái khám: ${status}`);
            if (status === 'all') {
                table.column(8).search('').draw();
            } else {
                table.column(8).search(status, true, false).draw();
            }
        });

        $('#warningDays').off('change').on('change', function() {
            loadPatients();
        });
    }

    // Tải danh sách bệnh nhân
    function loadPatients() {
        $.getJSON('/patients', function(patients) {
            console.log('Dữ liệu nhận từ /patients:', JSON.stringify(patients, null, 2));
            initTable(patients);
        }).fail(function(jqXHR, textStatus, error) {
            console.error('Lỗi tải bệnh nhân:', textStatus, error, jqXHR.responseText);
            alert('Không thể tải dữ liệu bệnh nhân: ' + error);
            initTable([]);
        });
    }

    // Gửi form nhập liệu
    $('#patientForm').on('submit', function(e) {
        e.preventDefault();
        const patient = {
            id: parseInt($('#id').val()) || 0,
            name: $('#name').val().trim() || '',
            year: parseInt($('#year').val()) || 0,
            gender: $('#gender').val() || '',
            house: $('#house').val().trim() || '',
            medication: $('#medication').val().trim() || '',
            examDate: $('#examDate').val() || '',
            reExamDate: $('#reExamDate').val() || '',
            area: $('#area').val() || ''
        };
        console.log('Dữ liệu gửi:', JSON.stringify(patient, null, 2));

        if (!patient.id || !patient.name || !patient.year || !patient.gender || !patient.area) {
            alert('Vui lòng nhập đầy đủ STT, Họ và Tên, Năm sinh, Giới tính, Phân khu');
            return;
        }
        if (patient.year < 1900 || patient.year > 2025) {
            alert('Năm sinh phải từ 1900 đến 2025');
            return;
        }
        if (!['I', 'II'].includes(patient.area)) {
            alert('Phân khu phải là I hoặc II');
            return;
        }
        if (patient.examDate && !isValidDate(patient.examDate)) {
            alert('Ngày khám không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy và là ngày có thật (ví dụ: 30/04/2025).');
            return;
        }
        if (patient.reExamDate && !isValidDate(patient.reExamDate)) {
            alert('Ngày tái khám không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy và là ngày có thật (ví dụ: 30/04/2025).');
            return;
        }

        const url = isEditMode ? '/patients' : '/patients';
        const method = isEditMode ? 'PUT' : 'POST';
        const originalId = parseInt($('#originalId').val()) || patient.id;

        $.ajax({
            url: url,
            type: method,
            contentType: 'application/json',
            data: JSON.stringify(isEditMode ? { ...patient, originalId } : patient),
            success: function(response) {
                console.log('Phản hồi:', response);
                alert(isEditMode ? 'Cập nhật bệnh nhân thành công!' : 'Lưu bệnh nhân thành công!');
                $('#patientForm')[0].reset();
                $('#patientModal').modal('hide');
                isEditMode = false;
                $('#patientModalLabel').text('Thêm bệnh nhân mới');
                loadPatients();
            },
            error: function(jqXHR, textStatus, errorThrown) {
                const errorMessage = jqXHR.responseJSON?.error || errorThrown;
                console.error('Lỗi:', {
                    status: jqXHR.status,
                    textStatus: textStatus,
                    error: errorMessage,
                    responseText: jqXHR.responseText
                });
                alert('Lỗi: ' + errorMessage);
            }
        });
    });

    // Tạo báo cáo
    $('#generateReportBtn').on('click', function() {
        const reportDate = $('#reportDate').val()?.trim();
        const endDate = $('#endDate').val()?.trim();
        const reportType = $('#reportType').val();
        const area = $('#areaFilter').val();
        console.log(`Yêu cầu báo cáo: ngày=${reportDate}, kiểu=${reportType}, khu=${area}, ngày kết thúc=${endDate}`);
        if (!reportDate || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(reportDate)) {
            alert('Vui lòng nhập ngày bắt đầu theo định dạng dd/mm/yyyy');
            return;
        }
        if (reportType === 'range' && (!endDate || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(endDate))) {
            alert('Vui lòng nhập ngày kết thúc theo định dạng dd/mm/yyyy');
            return;
        }
        const normalizedDate = reportDate.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, (match, day, month, year) => {
            return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        });
        const normalizedEndDate = endDate ? endDate.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, (match, day, month, year) => {
            return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        }) : '';
        const encodedDate = encodeURIComponent(normalizedDate);
        const encodedEndDate = encodeURIComponent(normalizedEndDate);
        const url = reportType === 'range' ? `/report/${encodedDate}?type=${reportType}&area=${area}&endDate=${encodedEndDate}` : `/report/${encodedDate}?type=${reportType}&area=${area}`;
        $.getJSON(url, function(report) {
            console.log('Dữ liệu báo cáo:', JSON.stringify(report, null, 2));
            initTable(report);
            alert(`Báo cáo ${reportType} (${normalizedDate}${normalizedEndDate ? ' đến ' + normalizedEndDate : ''}): ${report.length} bệnh nhân.`);
        }).fail(function(jqXHR, textStatus, error) {
            console.error('Lỗi tạo báo cáo:', textStatus, error, jqXHR.responseText);
            alert('Không thể tạo báo cáo: ' + (jqXHR.responseJSON?.error || error));
            initTable([]);
        });
    });

    // Xuất báo cáo ra Excel
    $('#exportReportBtn').on('click', function() {
        const reportDate = $('#reportDate').val()?.trim();
        const endDate = $('#endDate').val()?.trim();
        const reportType = $('#reportType').val();
        const area = $('#areaFilter').val();
        console.log(`Yêu cầu xuất báo cáo: ngày=${reportDate}, kiểu=${reportType}, khu=${area}, ngày kết thúc=${endDate}`);
        if (!reportDate || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(reportDate)) {
            alert('Vui lòng nhập ngày bắt đầu theo định dạng dd/mm/yyyy');
            return;
        }
        if (reportType === 'range' && (!endDate || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(endDate))) {
            alert('Vui lòng nhập ngày kết thúc theo định dạng dd/mm/yyyy');
            return;
        }
        const normalizedDate = reportDate.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, (match, day, month, year) => {
            return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        });
        const normalizedEndDate = endDate ? endDate.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, (match, day, month, year) => {
            return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        }) : '';
        const encodedDate = encodeURIComponent(normalizedDate);
        const encodedEndDate = encodeURIComponent(normalizedEndDate);
        const url = reportType === 'range' ? `/report/${encodedDate}/export?type=${reportType}&area=${area}&endDate=${encodedEndDate}` : `/report/${encodedDate}/export?type=${reportType}&area=${area}`;
        window.location.href = url;
    });

    // Reset form khi mở modal thêm mới
    $('#addPatientBtn').on('click', function() {
        isEditMode = false;
        $('#patientModalLabel').text('Thêm bệnh nhân mới');
        $('#patientForm')[0].reset();
        $('#originalId').val('');
    });

    // Sự kiện nút Sửa
    $('#patientTable tbody').on('click', '.edit-btn', function() {
        const id = $(this).data('id');
        const data = table.rows().data().toArray().find(row => row.id === id);
        if (!data) {
            console.error(`Không tìm thấy dữ liệu cho STT ${id}`);
            alert('Không tìm thấy dữ liệu để chỉnh sửa!');
            return;
        }
        console.log('Chỉnh sửa bệnh nhân:', JSON.stringify(data, null, 2));
        isEditMode = true;
        $('#patientModalLabel').text('Chỉnh sửa bệnh nhân');
        $('#originalId').val(data.id);
        $('#id').val(data.id);
        $('#name').val(data.name);
        $('#year').val(data.year);
        $('#gender').val(data.gender);
        $('#house').val(data.house);
        $('#medication').val(data.medication);
        $('#examDate').val(data.examDate);
        $('#reExamDate').val(data.reExamDate);
        $('#area').val(data.area ? data.area.replace('Khu ', '') : '');
        $('#patientModal').modal('show');
    });

    // Sự kiện nút Xóa
    $('#patientTable tbody').on('click', '.delete-btn', function() {
        const id = $(this).data('id');
        const data = table.rows().data().toArray().find(row => row.id === id);
        if (!data) {
            console.error(`Không tìm thấy dữ liệu cho STT ${id}`);
            alert('Không tìm thấy dữ liệu để xóa!');
            return;
        }
        if (confirm(`Bạn có chắc chắn muốn xóa bệnh nhân STT ${data.id} - ${data.name}?`)) {
            console.log(`Gửi yêu cầu xóa STT ${id}`);
            $.ajax({
                url: `/patients/${id}`,
                type: 'DELETE',
                success: function(response) {
                    console.log('Phản hồi xóa:', response);
                    alert('Xóa bệnh nhân thành công!');
                    loadPatients();
                },
                error: function(jqXHR, textStatus, errorThrown) {
                    const errorMessage = jqXHR.responseJSON?.error || errorThrown;
                    console.error('Lỗi xóa:', {
                        status: jqXHR.status,
                        textStatus: textStatus,
                        error: errorMessage,
                        responseText: jqXHR.responseText
                    });
                    alert('Lỗi: ' + errorMessage);
                }
            });
        }
    });

    // Tải danh sách ban đầu
    loadPatients();
});