$(document).ready(function() {
    let table;
    let isEditMode = false;
    let currentPage = 1;
    let currentReportParams = {};

    // Khởi tạo date picker với bản địa hóa tiếng Việt
    flatpickr('#examDate, #reExamDate, #reportDate, #endDate', {
        dateFormat: 'd/m/Y',
        allowInput: true,
        placeholder: 'dd/mm/yyyy',
        locale: 'vn',
        altInput: true,
        altFormat: 'd/m/Y',
        defaultDate: ['#reportDate', new Date()] // Đặt mặc định ngày hiện tại
    });

    // Hàm hiển thị thông báo
    function showMessage(message, type = 'success') {
        const alertDiv = $(`<div class="alert alert-${type} alert-dismissible fade show" role="alert"></div>`)
            .text(message)
            .append('<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>');
        $('.alert-container').empty().append(alertDiv);
        setTimeout(() => alertDiv.alert('close'), 5000);
    }

    // Hàm kiểm tra ngày hợp lệ
    function isValidDate(dateStr) {
        return moment(dateStr, 'DD/MM/YYYY', true).isValid();
    }

    // Hàm tính trạng thái tái khám
    function getReExamStatus(reExamDate, warningDays) {
        if (!reExamDate || !isValidDate(reExamDate)) {
            return { status: 'none', label: 'Không có ngày' };
        }
        const reExam = moment(reExamDate, 'DD/MM/YYYY').toDate();
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
            return { status: 'normal', label: 'Bình thường' };
        }
    }

    // Hàm hiển thị phân trang
    function renderPagination(totalPages, currentPage) {
        let paginationHtml = '<nav><ul class="pagination justify-content-center">';
        paginationHtml += `<li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage - 1}">Trước</a></li>`;
        for (let i = 1; i <= totalPages; i++) {
            paginationHtml += `<li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }
        paginationHtml += `<li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" data-page="${currentPage + 1}">Sau</a></li>`;
        paginationHtml += '</ul></nav>';
        $('#pagination').html(paginationHtml);

        $('.page-link').on('click', function(e) {
            e.preventDefault();
            const page = parseInt($(this).data('page'));
            if (page && page !== currentPage) {
                currentPage = page;
                generateReport();
            }
        });
    }

    // Khởi tạo DataTable
    function initTable(data) {
        if (table) {
            table.destroy();
            $('#patientTable tbody').empty();
        }
        const warningDays = parseInt($('#warningDays').val()) || 7;
        data = data.map(row => ({
            ...row,
            reExamStatus: getReExamStatus(row.reExamDate, warningDays)
        }));

        // Hiển thị tổng quan báo cáo
        const overdueCount = data.filter(row => row.reExamStatus.status === 'overdue').length;
        $('#reportSummary').html(`Tổng số bệnh nhân: ${data.length}. Quá hạn: ${overdueCount}`);
        if (overdueCount > 0) {
            showMessage(`Cảnh báo: Có ${overdueCount} bệnh nhân đã quá hạn tái khám!`, 'warning');
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
            language: { url: '//cdn.datatables.net/plug-ins/1.11.5/i18n/vi.json' },
            rowCallback: function(row, data) {
                $(row).find('td:eq(8)').addClass(`status-${data.reExamStatus.status}`);
            }
        });

        // Bộ lọc khu vực
        $('#areaFilter').off('change').on('change', function() {
            const area = $(this).val();
            if (area === 'all') {
                table.column(9).search('').draw();
            } else {
                table.column(9).search(`^${area}$`, true, false).draw();
            }
        });
    }

    // Tải danh sách bệnh nhân
    function loadPatients() {
        $.getJSON('/patients', function(patients) {
            initTable(patients);
            $('#pagination').empty();
        }).fail(function(jqXHR, textStatus, error) {
            showMessage('Không thể tải dữ liệu bệnh nhân: ' + error, 'danger');
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

        if (!patient.id || !patient.name || !patient.year || !patient.gender || !patient.area) {
            showMessage('Vui lòng nhập đầy đủ STT, Họ và Tên, Năm sinh, Giới tính, Phân khu', 'danger');
            return;
        }
        if (patient.year < 1900 || patient.year > 2025) {
            showMessage('Năm sinh phải từ 1900 đến 2025', 'danger');
            return;
        }
        if (!['I', 'II'].includes(patient.area)) {
            showMessage('Phân khu phải là I hoặc II', 'danger');
            return;
        }
        if (patient.examDate && !isValidDate(patient.examDate)) {
            showMessage('Ngày khám không hợp lệ', 'danger');
            return;
        }
        if (patient.reExamDate && !isValidDate(patient.reExamDate)) {
            showMessage('Ngày tái khám không hợp lệ', 'danger');
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
                showMessage(isEditMode ? 'Cập nhật bệnh nhân thành công!' : 'Lưu bệnh nhân thành công!');
                $('#patientForm')[0].reset();
                $('#patientModal').modal('hide');
                isEditMode = false;
                $('#patientModalLabel').text('Thêm bệnh nhân mới');
                loadPatients();
            },
            error: function(jqXHR, textStatus, errorThrown) {
                const errorMessage = jqXHR.responseJSON?.error || errorThrown;
                showMessage('Lỗi: ' + errorMessage, 'danger');
            }
        });
    });

    // Tạo báo cáo
    function generateReport() {
        const reportDate = $('#reportDate').val()?.trim();
        const endDate = $('#endDate').val()?.trim();
        const reportType = $('#reportType').val();
        const area = $('#areaFilter').val();
        const warningDays = parseInt($('#warningDays').val()) || 7;
        const selectedStatuses = $('.status-checkbox:checked').map(function() {
            return $(this).val();
        }).get();

        if (!reportDate || !isValidDate(reportDate)) {
            showMessage('Vui lòng nhập ngày bắt đầu hợp lệ (dd/mm/yyyy)', 'danger');
            return;
        }
        if (reportType === 'range') {
            if (!endDate || !isValidDate(endDate)) {
                showMessage('Vui lòng nhập ngày kết thúc hợp lệ (dd/mm/yyyy)', 'danger');
                return;
            }
            if (moment(endDate, 'DD/MM/YYYY').isBefore(moment(reportDate, 'DD/MM/YYYY'))) {
                showMessage('Ngày kết thúc phải sau ngày bắt đầu', 'danger');
                return;
            }
        }
        if (selectedStatuses.length === 0) {
            showMessage('Vui lòng chọn ít nhất một trạng thái tái khám', 'danger');
            return;
        }
        if (warningDays < 0 || warningDays > 30) {
            showMessage('Ngưỡng cảnh báo phải từ 0 đến 30 ngày', 'danger');
            return;
        }

        const normalizedDate = moment(reportDate, 'DD/MM/YYYY').format('DD/MM/YYYY');
        const normalizedEndDate = endDate ? moment(endDate, 'DD/MM/YYYY').format('DD/MM/YYYY') : '';
        const encodedDate = encodeURIComponent(normalizedDate);
        const encodedEndDate = encodeURIComponent(normalizedEndDate);
        const statusQuery = selectedStatuses.map(status => `status=${status}`).join('&');
        const url = reportType === 'range'
            ? `/report/${encodedDate}?type=${reportType}&area=${area}&endDate=${encodedEndDate}&${statusQuery}&warningDays=${warningDays}&page=${currentPage}&limit=100`
            : `/report/${encodedDate}?type=${reportType}&area=${area}&${statusQuery}&warningDays=${warningDays}&page=${currentPage}&limit=100`;

        currentReportParams = { reportDate, endDate, reportType, area, selectedStatuses, warningDays };

        $.getJSON(url, function(response) {
            initTable(response.data);
            renderPagination(response.totalPages, currentPage);
            showMessage(`Báo cáo ${reportType} (${normalizedDate}${normalizedEndDate ? ' đến ' + normalizedEndDate : ''}): ${response.total} bệnh nhân.`);
        }).fail(function(jqXHR, textStatus, error) {
            showMessage('Không thể tạo báo cáo: ' + (jqXHR.responseJSON?.error || error), 'danger');
            initTable([]);
            $('#pagination').empty();
        });
    }

    $('#generateReportBtn').on('click', function() {
        currentPage = 1;
        generateReport();
    });

    // Xuất báo cáo ra Excel
    $('#exportReportBtn').on('click', function() {
        const reportDate = $('#reportDate').val()?.trim();
        const endDate = $('#endDate').val()?.trim();
        const reportType = $('#reportType').val();
        const area = $('#areaFilter').val();
        const warningDays = parseInt($('#warningDays').val()) || 7;
        const selectedStatuses = $('.status-checkbox:checked').map(function() {
            return $(this).val();
        }).get();

        if (!reportDate || !isValidDate(reportDate)) {
            showMessage('Vui lòng nhập ngày bắt đầu hợp lệ (dd/mm/yyyy)', 'danger');
            return;
        }
        if (reportType === 'range') {
            if (!endDate || !isValidDate(endDate)) {
                showMessage('Vui lòng nhập ngày kết thúc hợp lệ (dd/mm/yyyy)', 'danger');
                return;
            }
            if (moment(endDate, 'DD/MM/YYYY').isBefore(moment(reportDate, 'DD/MM/YYYY'))) {
                showMessage('Ngày kết thúc phải sau ngày bắt đầu', 'danger');
                return;
            }
        }
        if (selectedStatuses.length === 0) {
            showMessage('Vui lòng chọn ít nhất một trạng thái tái khám', 'danger');
            return;
        }
        if (warningDays < 0 || warningDays > 30) {
            showMessage('Ngưỡng cảnh báo phải từ 0 đến 30 ngày', 'danger');
            return;
        }

        const normalizedDate = moment(reportDate, 'DD/MM/YYYY').format('DD/MM/YYYY');
        const normalizedEndDate = endDate ? moment(endDate, 'DD/MM/YYYY').format('DD/MM/YYYY') : '';
        const encodedDate = encodeURIComponent(normalizedDate);
        const encodedEndDate = encodeURIComponent(normalizedEndDate);
        const statusQuery = selectedStatuses.map(status => `status=${status}`).join('&');
        const url = reportType === 'range'
            ? `/report/${encodedDate}/export?type=${reportType}&area=${area}&endDate=${encodedEndDate}&${statusQuery}&warningDays=${warningDays}`
            : `/report/${encodedDate}/export?type=${reportType}&area=${area}&${statusQuery}&warningDays=${warningDays}`;
        window.location.href = url;
    });

    // Reset bộ lọc
    $('#resetFilterBtn').on('click', function() {
        $('#areaFilter').val('all');
        $('#reportDate').val(moment().format('DD/MM/YYYY'));
        $('#endDate').val('');
        $('#reportType').val('day');
        $('.status-checkbox').prop('checked', true);
        $('#warningDays').val(7);
        currentPage = 1;
        loadPatients();
    });

    // Reset form nhập liệu khi mở modal thêm mới
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
            showMessage('Không tìm thấy dữ liệu để chỉnh sửa!', 'danger');
            return;
        }
        isEditMode = true;
        $('#patientModalLabel').text('Chỉnh sửa bệnh nhân');
        $('#originalId').val(id);
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
            showMessage('Không tìm thấy dữ liệu để xóa!', 'danger');
            return;
        }
        if (confirm(`Bạn có chắc chắn muốn xóa bệnh nhân STT ${data.id} - ${data.name}?`)) {
            $.ajax({
                url: `/patients/${id}`,
                type: 'DELETE',
                success: function(response) {
                    showMessage('Xóa bệnh nhân thành công!');
                    loadPatients();
                },
                error: function(jqXHR, textStatus, errorThrown) {
                    const errorMessage = jqXHR.responseJSON?.error || errorThrown;
                    showMessage('Lỗi xóa: ' + errorMessage, 'danger');
                }
            });
        }
    });

    // Nhập bệnh nhân từ file Excel
    $('#importExcelBtn').on('click', function() {
        const fileInput = $('#uploadExcel')[0];
        if (!fileInput.files || fileInput.files.length === 0) {
            showMessage('Vui lòng chọn file Excel', 'danger');
            return;
        }
        const file = fileInput.files[0];
        if (!file.name.endsWith('.xlsx')) {
            showMessage('File phải có định dạng .xlsx', 'danger');
            return;
        }

        const formData = new FormData();
        formData.append('excelFile', file);

        $.ajax({
            url: '/patients/import',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(response) {
                showMessage(`Nhập thành công ${response.imported} bệnh nhân. ${response.errors.length} lỗi: ${response.errors.join(', ')}`);
                loadPatients();
                $('#uploadExcel').val('');
            },
            error: function(jqXHR, textStatus, errorThrown) {
                const errorMessage = jqXHR.responseJSON?.error || errorThrown;
                showMessage('Lỗi nhập file: ' + errorMessage, 'danger');
            }
        });
    });

    // Cập nhật bảng khi thay đổi ngưỡng cảnh báo
    $('#warningDays').on('change', function() {
        if (currentReportParams.reportDate) {
            generateReport();
        } else {
            loadPatients();
        }
    });

    // Tải danh sách bệnh nhân ban đầu
    loadPatients();
});